import { expect, test } from "vite-plus/test";
import { join } from "node:path/posix";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import {
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from "@scatool/analyzer-plugin-javascript";
import { gomodExtractor } from "@scatool/analyzer-plugin-go";
import { gradleExtractor } from "@scatool/analyzer-plugin-gradle";
import { cargoLockExtractor } from "@scatool/analyzer-plugin-rust";
import {
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
  pyprojectTomlExtractor,
  requirementsTxtExtractor,
} from "@scatool/analyzer-plugin-python";
import type { Extractor } from "@scatool/analyzer-core";
import { mergeResults, normalizeResult, runCommand } from "@scatool/analyzer-core";
import { extractor as conanfileExtractor } from "@scatool/analyzer-plugin-conan";
import { extractor as vcpkgExtractor } from "@scatool/analyzer-plugin-vcpkg";
import { z } from "zod";
import { chdir } from "node:process";

// set consistent working directory
chdir(import.meta.dirname);

const repositoriesDir = `${import.meta.dirname}/repositories`.replaceAll("\\", "/");

// All available extractors
const allExtractors: Extractor[] = [
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
  gomodExtractor,
  gradleExtractor,
  cargoLockExtractor,
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
  pyprojectTomlExtractor,
  requirementsTxtExtractor,
  conanfileExtractor,
  vcpkgExtractor,
];

import {
  codebaseIdFor,
  sha256,
  requireAcceptedCase,
  validateAcceptanceLedger,
  validateAcceptedBaseline,
  type RepositoryConfig,
} from "./integration-acceptance.ts";
const configurationText = await readFile(join(import.meta.dirname, "repositories.json"), "utf8");
const repositoriesConfig: RepositoryConfig[] = JSON.parse(configurationText);
const acceptanceCases = validateAcceptanceLedger(
  configurationText,
  JSON.parse(await readFile(join(import.meta.dirname, "integration-migration.json"), "utf8")),
);

const globalOptionSchema = z.strictObject(
  allExtractors.reduce(
    (map, extractor) => {
      if (extractor.optionsSchema) {
        map[extractor.name] = extractor.optionsSchema.optional();
      }
      return map;
    },
    {} as Record<string, z.ZodType<unknown>>,
  ),
);

// Load system configuration (optional)
interface SystemConfig {
  java?: {
    [version: string]: string | null;
  };
}
const systemConfigPath = join(import.meta.dirname, "system.json");
let systemConfig: SystemConfig = {};
if (existsSync(systemConfigPath)) {
  try {
    systemConfig = JSON.parse(await readFile(systemConfigPath, "utf8"));
  } catch (error) {
    console.warn("Failed to load system.json:", error);
  }
}

for (const config of repositoriesConfig) {
  const repoName = `${config.owner}+${config.repository}`;

  test(
    repoName,
    async () => {
      const repoPath = join(repositoriesDir, repoName);
      const acceptance = acceptanceCases.find((entry) => entry.id === repoName)!;
      requireAcceptedCase(acceptance);
      if (Array.isArray(acceptance.reviewEvidence)) throw new Error("Missing review evidence");
      const snapshot = validateAcceptedBaseline(
        acceptance,
        await readFile(join(import.meta.dirname, "..", acceptance.baseline.path), "utf8"),
        await readFile(
          join(import.meta.dirname, "..", acceptance.reviewEvidence.review.path),
          "utf8",
        ),
      );
      if (
        !existsSync(repoPath) ||
        existsSync(join(repositoriesDir, `${repoName}.tar.gz`)) ||
        (await readdir(repoPath)).every((name) => name === ".gitkeep")
      ) {
        throw new Error(
          `Pinned repository input is missing or incomplete: ${repoName}@${config.commit}`,
        );
      }
      for (const source of acceptance.reviewEvidence.source.files) {
        const actualHash = sha256(await readFile(join(repoPath, source.path)));
        if (actualHash !== source.sha256)
          throw new Error(`Reviewed source hash mismatch: ${repoName}/${source.path}`);
      }
      const codebaseId = codebaseIdFor(config);

      if (config.options !== undefined) {
        // validate only
        try {
          globalOptionSchema.parse(config.options);
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new Error("Error validating extractor options!\n" + z.prettifyError(error), {
              cause: error,
            });
          } else {
            throw new Error(
              "Error validating extractor options: " +
                (error instanceof Error ? error.message : String(error)),
              { cause: error },
            );
          }
        }
      }

      // Switch Java version if needed
      const originalJavaHome = process.env.JAVA_HOME;
      const originalPath = process.env.PATH;
      if (config.javaVersion) {
        const configuredPath = systemConfig.java?.[config.javaVersion.toString()];
        if (configuredPath) {
          const { exitCode } = await runCommand(["test", "-d", configuredPath]);
          if (exitCode === 0) {
            process.env.JAVA_HOME = configuredPath;
            process.env.PATH = `${configuredPath}/bin:${process.env.PATH}`;
          } else {
            throw new Error(
              `Configured Java ${config.javaVersion} path does not exist: ${configuredPath}. Please update test/system.json`,
            );
          }
        } else {
          throw new Error(
            `Java ${config.javaVersion} is required but not configured in test/system.json`,
          );
        }
      }

      try {
        const results = await Promise.all(
          allExtractors.map((extractor) =>
            extractor.extract(repoPath, config.options?.[extractor.name], { codebaseId }),
          ),
        );

        // Merge all results
        const mergedResult = mergeResults(results, { codebase: codebaseId });

        const normalizedResult = normalizeResult(mergedResult);
        expect(normalizedResult).toEqual(snapshot);
      } finally {
        // Restore original Java version
        if (config.javaVersion) {
          if (originalJavaHome !== undefined) {
            process.env.JAVA_HOME = originalJavaHome;
          } else {
            delete process.env.JAVA_HOME;
          }
          if (originalPath !== undefined) process.env.PATH = originalPath;
          else delete process.env.PATH;
        }
      }
    },
    300000, // 5 minutes
  );
}
