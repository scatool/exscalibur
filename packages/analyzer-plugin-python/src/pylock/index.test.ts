import { join } from "node:path/posix";
import { expect, test } from "vite-plus/test";
import type { AnalyzerResult } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";

// Forward slashes, so result paths are made relative to the codebase on Windows too
const fixturesDir = join(import.meta.dirname, "__fixtures__").replaceAll("\\", "/");

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/{pylock.toml,pylock.*.toml}",
});

/** Checks the multiple-envs project only; `prefix` is its directory relative to the codebase ("" or "multiple-envs/"). */
function expectDevLockfileIgnored(result: AnalyzerResult, prefix = ""): void {
  const subproject = result.subprojects.find(
    (s) => s.definitionFile === `${prefix}pyproject.toml`,
  )!;
  const scopes = subproject.scopes.map((s) => s.scope);
  expect(scopes).toContain("env.default");
  expect(scopes).not.toContain("env.dev");
  const evidence = result.packages
    .flatMap((pkg) => pkg.evidence)
    .filter((entry) => entry.startsWith(prefix));
  expect(evidence.length).toBeGreaterThan(0);
  expect(evidence.some((entry) => entry.includes(`${prefix}pylock.dev.toml`))).toBe(false);
}

test("unnormalized dependency specs resolve to normalized lockfile names", async () => {
  // pyproject.toml requires "zope.interface", the lockfile names the package "zope-interface".
  // "six" resolves regardless, so the fallback scope cannot hide a missed "zope.interface".
  const result = await extractor.extract(join(fixturesDir, "name-normalization"));
  expect(result.issues).toEqual([]);
  expect(result.subprojects).toHaveLength(1);
  expect(result.subprojects[0]!.purl).toBe("pkg:pypi/my.project@0.0.1");
  expect(result.subprojects[0]!.scopes).toEqual([
    {
      scope: "dependencies",
      packages: ["pkg:pypi/six@1.17.0", "pkg:pypi/zope-interface@8.7"],
    },
  ]);
});

test("optional dependencies and dependency groups keep their pyproject scopes", async () => {
  const result = await extractor.extract(join(fixturesDir, "optional-and-groups"));
  expect(result.issues).toEqual([]);
  expect(result.subprojects[0]!.scopes).toEqual([
    { scope: "dependencies", packages: ["pkg:pypi/six@1.17.0"] },
    { scope: "group.docs", packages: ["pkg:pypi/certifi@2026.11.20"] },
    { scope: "optional.test", packages: ["pkg:pypi/idna@3.20"] },
  ]);
});

test("sibling lockfiles excluded by runtime ignore patterns are not read", async () => {
  const result = await extractor.extract(join(fixturesDir, "multiple-envs"), undefined, {
    ignore: ["**/pylock.dev.toml"],
  });
  expectDevLockfileIgnored(result);
});

test("sibling lockfiles excluded by codebase-relative ignore patterns are not read", async () => {
  const result = await extractor.extract(fixturesDir, {
    ignore: ["multiple-envs/pylock.dev.toml"],
  });
  expectDevLockfileIgnored(result, "multiple-envs/");
});
