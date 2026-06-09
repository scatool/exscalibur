import { dirname, join } from "path/posix";
import { resolve } from "path";
import { createExtractorTests, scanFixtures } from "@scatool/analyzer-test-utils";
import { extractor as vcpkgExtractor } from "./index.ts";
import { type VcpkgOptions, type VcpkgTargetPlatform, optionsSchema } from "./options";
import { test, expect } from "vitest";
import os, { tmpdir } from "node:os";
import { copyFile, rm, mkdtemp } from "node:fs/promises";
import { loadTransitiveDependencies, portToVersion } from "./vcpkg.ts";
import type { VcpkgPort } from "./types.ts";
import {
  findExecutable,
  readNormalizedTextFile,
  runCommand,
  type AnalyzerResult,
} from "@scatool/analyzer-core";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

/*
 * This file makes use of three different test styles:
 * 1. Snapshot tests for individual fixtures
 * 2. Individual tests for fixtures to ensure that certain properties hold (e.g., that the "simple" fixture is platform and feature independent)
 * 3. Compare extractor results with `vcpkg install --dry-run` and `vcpkg depend-info`, which serves as a "real-world" reference. Note that this can only be used to verify dependencies on the current platform.
 *
 * Reproducibility considerations:
 * For reproducible test results, it is crucial to ensure that the dependencies of the vcpkg.json files in the fixtures do not change over time.
 * This is achieved by setting the "builtin-baseline" to a specific git commit hash (see "vcpkg.json" files in the fixtures).
 * This way, even if the vcpkg ports repository is updated, the same versions of the dependencies will be used for the tests, ensuring stable and consistent test results.
 *
 * Note: If it becomes necessary to update the dependencies in the fixtures, the "builtin-baseline" can be updated to a newer commit hash.
 */

/*
 * To provide test coverage for different extraction scenarios (e.g., with/without features, different platforms),
 * multiple test runs with different extractor options are created for the fixtures.
 */
const testConfigs: {
  name: string;
  options: Partial<VcpkgOptions>;
}[] = [
  {
    name: "[all platforms & default features]",
    options: {
      includeAllFeatures: false,
    },
  },
  {
    name: "[all platforms & all features]",
    options: {
      includeAllFeatures: true,
    },
  },
  {
    name: "[linux-x64 platform & default features]",
    options: {
      includeAllFeatures: false,
      targetPlatform: {
        targetArchitecture: "x64",
        cmakeSystemName: "Linux",
        isNative: true,
      },
    },
  },
  {
    name: "[linux-x64 platform & all features]",
    options: {
      includeAllFeatures: true,
      targetPlatform: {
        targetArchitecture: "x64",
        cmakeSystemName: "Linux",
        isNative: true,
      },
    },
  },
];

// ############ 1. Snapshot tests for individual fixtures ############
for (const { name, options } of testConfigs) {
  await createExtractorTests({
    namePrefix: name,
    options,
    extractor: vcpkgExtractor,
    fixturesDir,
    pattern: "*/vcpkg.json",
    timeout: 30000,
  });
}

// ############ 2. Individual tests to ensure certain properties hold ############
function createEquivalenceClassTest(
  testName: string,
  fixture: string,
  eqClasses: { allHosts: boolean; allFeatures: boolean }[][],
) {
  test(testName, async () => {
    const fixturePath = join(fixturesDir, fixture);
    const results = await Promise.all(
      testConfigs.map(async (config) => ({
        config: {
          allHosts: config.options.targetPlatform === undefined,
          allFeatures: config.options.includeAllFeatures,
        },
        result: await vcpkgExtractor.extract(fixturePath, config.options),
      })),
    );

    function configurationToResult(toFind: {
      allHosts: boolean;
      allFeatures: boolean;
    }): AnalyzerResult {
      return results.find(
        ({ config }) =>
          config.allHosts === toFind.allHosts && config.allFeatures === toFind.allFeatures,
      )!.result;
    }

    // inside equivalence classes: tests for equality
    for (const eqClass of eqClasses) {
      for (const configuration of eqClass.slice(1)) {
        expect(
          configurationToResult(configuration),
          `Equality class ${eqClasses.indexOf(eqClass)} should contain equivalent results`,
        ).toEqual(configurationToResult(eqClass[0]!));
      }
    }

    // outside equivalence classes: tests for inequality
    for (let i = 0; i < eqClasses.length; i++) {
      for (let j = i + 1; j < eqClasses.length; j++) {
        const configA = eqClasses[i]![0]!;
        const configB = eqClasses[j]![0]!;
        expect(
          configurationToResult(configA),
          `Equality classes ${i} and ${j} should not match`,
        ).not.toEqual(configurationToResult(configB));
      }
    }
  });
}

createEquivalenceClassTest("simple fixture should be platform and feature independent", "simple", [
  [
    { allHosts: true, allFeatures: false },
    { allHosts: true, allFeatures: true },
    { allHosts: false, allFeatures: false },
    { allHosts: false, allFeatures: true },
  ],
]);
createEquivalenceClassTest(
  "transitive fixture should not be platform independent and not be feature independent",
  "transitive",
  [
    [{ allHosts: true, allFeatures: false }],
    [{ allHosts: true, allFeatures: true }],
    [{ allHosts: false, allFeatures: true }],
    [{ allHosts: false, allFeatures: false }],
  ],
);

// ############ 3. Verify extractor by using platform-dependent vcpkg commands ############
// get the target triplet and the corresponding plugin options (VcpkgTargetPlatform) for the current platform
// reference: https://github.com/microsoft/vcpkg/tree/master/triplets
//
// Note that `vcpkg install --dry-run` and `vcpkg depend-info` were seen multiple times to disagree on the features
// However, `vcpkg depend-info` seems more consistent, which is why we use it in the following to verify features
const vcpkgPath = findExecutable("vcpkg") || "vcpkg";

function getCurrentPlatformConfig(): { triplet: string; targetPlatform: VcpkgTargetPlatform } {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "win32" && (arch === "x64" || arch === "ia32")) {
    const targetArchitecture = arch === "ia32" ? "x86" : "x64";
    return {
      triplet: `${targetArchitecture}-windows`,
      targetPlatform: {
        targetArchitecture,
        cmakeSystemName: "",
        crtLinkage: "dynamic",
        libraryLinkage: "dynamic",
        isNative: true,
      },
    };
  } else if (
    (platform === "linux" || platform === "darwin") &&
    (arch === "x64" || arch === "arm64")
  ) {
    return {
      triplet: arch + "-" + (platform === "linux" ? "linux" : "osx"),
      targetPlatform: {
        targetArchitecture: arch,
        cmakeSystemName: platform === "linux" ? "Linux" : "Darwin",
        crtLinkage: "dynamic",
        libraryLinkage: "static",
        isNative: true,
      },
    };
  }

  throw new Error(`Unsupported platform/architecture combination: ${platform}/${arch}`);
}

const { triplet, targetPlatform } = getCurrentPlatformConfig();
const fixtures = await scanFixtures(fixturesDir, "*/vcpkg.json");

for (const fixture of fixtures) {
  test(`vcpkg install --dry-run should match dependencies extracted for ${fixture}`, async () => {
    const fixturePath = join(fixturesDir, fixture, "vcpkg.json");

    // note: using non-posix resolve is important here, because else on
    // Windows the following will happen: resolve('C:\\path') === '/Users/cwd/C:/path'
    const file = resolve(fixturePath).replaceAll("\\", "/");

    const vcpkgContent = await readNormalizedTextFile(file);

    const vcpkgJson = JSON.parse(vcpkgContent) as VcpkgPort;
    const vcpkgFileDir = dirname(file);

    const { ports, missingPorts } = await loadTransitiveDependencies(
      vcpkgJson,
      vcpkgFileDir,
      optionsSchema.parse({
        includeAllFeatures: false,
        targetPlatform,
      }),
    );

    expect(missingPorts).toEqual([]);

    const tempDir = await mkdtemp(join(tmpdir().replaceAll("\\", "/"), `vcpkg-test-${fixture}-`));
    await copyFile(fixturePath, join(tempDir, "vcpkg.json"));

    // 1. check ports and their versions
    await verifyInstallDryRun(
      tempDir,
      ports
        .entries()
        .map(([name, portInfo]) => {
          return { name: name, version: portToVersion(portInfo.port)! };
        })
        .toArray(),
    );

    // 2. check relations
    await verifyDependInfo(
      tempDir,
      ports
        .entries()
        .map(([name, portInfo]) => {
          let features = null;
          if ((portInfo.port.features ?? []).length) {
            // the output of dependInfo adds a feature array only if the port has at least one feature
            features = [...portInfo.features];
            if (!portInfo.defaultFeatures) {
              // core means we exclude all core features
              features.push("core");
            }
          }

          return { from: name, to: [...portInfo.dependencies.keys()], features };
        })
        .toArray(),
    );

    await rm(tempDir, { recursive: true });
  }, 60000);
}

async function verifyInstallDryRun(
  dir: string,
  extractedPackages: { name: string; version: string }[],
) {
  const { exitCode, stdout, stderr } = await runCommand(
    [vcpkgPath, "install", "--dry-run", `--triplet=${triplet}`, `--host-triplet=${triplet}`],
    {
      cwd: dir,
    },
  );

  expect(exitCode, "stderr: " + stderr).toBe(0);

  const lines = stdout.split("\n");
  // remove all unrelated lines before the list of packages to be installed and the summary line at the end
  const expectedPackages = lines
    .map((line) => ({
      match: line
        .replace(/^\s*\*?\s*/, "")
        .trim()
        .match(/^([^:[]+)(\[[^\]]+\])?:([^@]+)@([^#\s]+)/),
      line,
    }))
    .filter(({ match }) => match !== null)
    .map(({ match }) => ({
      name: match![1] ?? "[unknown]",
      version: match![4] ?? "[unknown]",
    }));

  function comparePackage(
    a: { name?: string; version?: string },
    b: { name?: string; version?: string },
  ): number {
    return (a.name ?? "").localeCompare(b.name ?? "");
  }

  expect(extractedPackages.sort(comparePackage)).toEqual(expectedPackages.sort(comparePackage));
}

async function verifyDependInfo(
  dir: string,
  extractedRelations: { from: string; features: string[] | null; to: string[] }[],
) {
  const { exitCode, stderr } = await runCommand(
    [
      vcpkgPath,
      "depend-info",
      `--triplet=${triplet}`,
      `--host-triplet=${triplet}`,
      "--format=list",
    ],
    {
      cwd: dir,
    },
  );

  expect(exitCode).toBe(0);

  const output = stderr;
  const lines = output.split("\n");

  const expectedRelations = lines
    .map((line) => ({
      // match "[package][[features]]: [dependency1], [dependency2], ..."
      match: line.match(/^([^:[]+)(\[[^\]]+\])?:([^@]*)/),
      line,
    }))
    .filter(({ match }) => match !== null)
    .map(({ match, line }) => {
      match = match!;

      const [from, toStr] = [match[1]!, match[3]!];
      if (!from || !toStr) {
        throw new Error(`Unexpected line format: "${line}"`);
      }

      const to = toStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      let features = null;
      if (extractedRelations.find((rel) => rel.from === from)?.features !== null) {
        features = match[2]
          ? match[2]
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
          : [];
      }

      return { from: from.trim(), to, features };
    });

  extractedRelations.forEach((rel) => {
    rel.to.sort();
    rel.features?.sort();
  });
  expectedRelations.forEach((rel) => {
    rel.to.sort();
    rel.features?.sort();
  });

  function compareRelation(
    a: { from?: string; to?: string[] },
    b: { from?: string; to?: string[] },
  ): number {
    return (a.from ?? "").localeCompare(b.from ?? "");
  }

  expect(extractedRelations.sort(compareRelation)).toEqual(expectedRelations.sort(compareRelation));
}
