import { expect, test } from "vitest";
import { join } from "node:path/posix";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
import { conanfileExtractor, vcpkgExtractor } from "@scatool/analyzer-plugin-cpp";
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

interface RepositoryConfig {
  owner: string;
  repository: string;
  commit: string;
  options?: Record<string, Partial<unknown>>;
  javaVersion?: number;
}

// Load repository configuration
const repositoriesConfig: RepositoryConfig[] = JSON.parse(
  await readFile(join(import.meta.dirname, "repositories.json"), "utf8"),
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
      let originalJavaHome: string | undefined;
      if (config.javaVersion) {
        originalJavaHome = process.env.JAVA_HOME;

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
            extractor.extract(repoPath, config.options?.[extractor.name]),
          ),
        );

        // Merge all results
        const mergedResult = mergeResults(results);

        // Normalize paths in evidence and definitionFile for consistent snapshots
        for (const pkg of mergedResult.packages) {
          pkg.evidence = pkg.evidence.map((e: string) =>
            e.replace(repositoriesDir, "<repositories>"),
          );
        }

        for (const subproject of mergedResult.subprojects) {
          subproject.definitionFile = subproject.definitionFile.replace(
            repositoriesDir,
            "<repositories>",
          );
        }

        for (const issue of mergedResult.issues) {
          if (issue.file) {
            issue.file = issue.file.replace(repositoriesDir, "<repositories>");
          }
        }

        // Re-normalize after path replacement to ensure consistent ordering
        const normalizedResult = normalizeResult(mergedResult);

        // Write snapshot to individual JSON file
        const snapshotPath = join(import.meta.dirname, "__snapshots__", `${repoName}.json`);

        const updateSnapshots = process.env.UPDATE_SNAPSHOTS === "1";
        const snapshotExists = existsSync(snapshotPath);

        if (updateSnapshots) {
          // Update snapshot
          await writeFile(snapshotPath, JSON.stringify(normalizedResult, null, 2) + "\n");
          return; // No need to compare if we just updated it
        } else if (!snapshotExists) {
          // Create snapshot
          await writeFile(snapshotPath, JSON.stringify(normalizedResult, null, 2) + "\n");
          return; // No need to compare if we just created it
        }

        // Read and compare with snapshot
        const snapshotContent = await readFile(snapshotPath, "utf8");
        const snapshot = JSON.parse(snapshotContent);

        expect(normalizedResult).toEqual(snapshot);
      } finally {
        // Restore original Java version
        if (config.javaVersion && originalJavaHome !== undefined) {
          if (originalJavaHome) {
            process.env.JAVA_HOME = originalJavaHome;
          } else {
            delete process.env.JAVA_HOME;
          }
        }
      }
    },
    300000, // 5 minutes
  );
}
