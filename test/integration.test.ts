import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { file } from 'bun';
import {
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from '@scatool/analyzer-plugin-javascript/src/index.ts';
import { gomodExtractor } from '@scatool/analyzer-plugin-go/src/index.ts';
import { gradleExtractor } from '@scatool/analyzer-plugin-gradle/src/index.ts';
import { cargoLockExtractor } from '@scatool/analyzer-plugin-rust/src/index.ts';
import type { Extractor } from '@scatool/analyzer-core/src/index.ts';
import { mergeResults, normalizeResult } from '@scatool/analyzer-core/src/index.ts';

const repositoriesDir = `${import.meta.dir}/repositories`;

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
];

interface RepositoryConfig {
  owner: string;
  repository: string;
  commit: string;
  javaVersion?: number;
}

// Load repository configuration
const repositoriesConfigFile = file(join(import.meta.dir, 'repositories.json'));
const repositoriesConfig: RepositoryConfig[] = await repositoriesConfigFile.json();

// Load system configuration (optional)
interface SystemConfig {
  java?: {
    [version: string]: string | null;
  };
}
const systemConfigFile = file(join(import.meta.dir, 'system.json'));
let systemConfig: SystemConfig = {};
if (await systemConfigFile.exists()) {
  try {
    systemConfig = await systemConfigFile.json();
  } catch (error) {
    console.warn('Failed to load system.json:', error);
  }
}

for (const config of repositoriesConfig) {
  const repoName = `${config.owner}+${config.repository}`;

  test(
    repoName,
    async () => {
      const repoPath = join(repositoriesDir, repoName);

      // Switch Java version if needed
      let originalJavaHome: string | undefined;
      if (config.javaVersion) {
        originalJavaHome = process.env.JAVA_HOME;

        const configuredPath = systemConfig.java?.[config.javaVersion.toString()];
        if (configuredPath) {
          const { exitCode } = Bun.spawnSync(['test', '-d', configuredPath]);
          if (exitCode === 0) {
            process.env.JAVA_HOME = configuredPath;
            process.env.PATH = `${configuredPath}/bin:${process.env.PATH}`;
          } else {
            throw new Error(
              `Configured Java ${config.javaVersion} path does not exist: ${configuredPath}. Please update test/system.json`,
            );
          }
        } else {
          throw new Error(`Java ${config.javaVersion} is required but not configured in test/system.json`);
        }
      }

      try {
        const results = await Promise.all(allExtractors.map((extractor) => extractor.extract(repoPath)));

        // Merge all results
        const mergedResult = mergeResults(results);

        // Normalize paths in evidence and definitionFile for consistent snapshots
        for (const pkg of mergedResult.packages) {
          pkg.evidence = pkg.evidence.map((e: string) => e.replace(repositoriesDir, '<repositories>'));
        }

        for (const subproject of mergedResult.subprojects) {
          subproject.definitionFile = subproject.definitionFile.replace(repositoriesDir, '<repositories>');
        }

        for (const issue of mergedResult.issues) {
          if (issue.file) {
            issue.file = issue.file.replace(repositoriesDir, '<repositories>');
          }
        }

        // Re-normalize after path replacement to ensure consistent ordering
        const normalizedResult = normalizeResult(mergedResult);

        // Write snapshot to individual JSON file
        const snapshotPath = join(import.meta.dir, '__snapshots__', `${repoName}.json`);
        const snapshotFile = file(snapshotPath);

        const updateSnapshots = process.env.UPDATE_SNAPSHOTS === '1';
        const snapshotExists = await snapshotFile.exists();

        if (updateSnapshots) {
          // Update snapshot
          await Bun.write(snapshotPath, JSON.stringify(normalizedResult, null, 2) + '\n');
          return; // No need to compare if we just updated it
        } else if (!snapshotExists) {
          // Create snapshot
          await Bun.write(snapshotPath, JSON.stringify(normalizedResult, null, 2) + '\n');
          return; // No need to compare if we just created it
        }

        // Read and compare with snapshot
        const snapshotContent = await snapshotFile.text();
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
    { timeout: 300000 }, // 5 minutes
  );
}
