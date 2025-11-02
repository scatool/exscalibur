import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { file } from 'bun';
import {
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from '@scatool/analyzer-plugin-javascript/src/index.ts';
import type { Extractor } from '@scatool/analyzer-core/src/index.ts';
import { mergeResults } from '@scatool/analyzer-core/src/index.ts';

const repositoriesDir = `${import.meta.dir}/repositories`;

// All available extractors
const allExtractors: Extractor[] = [
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
];

// Scan for repository directories
const entries = await readdir(repositoriesDir, { withFileTypes: true });
const repositories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const repoName of repositories) {
  test(repoName, async () => {
    const repoPath = join(repositoriesDir, repoName);

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

    // Write snapshot to individual JSON file
    const snapshotPath = join(import.meta.dir, '__snapshots__', `${repoName}.json`);
    const snapshotFile = file(snapshotPath);

    const updateSnapshots = process.argv.includes('--update-snapshots') || process.argv.includes('-u');
    const snapshotExists = await snapshotFile.exists();

    if (updateSnapshots || !snapshotExists) {
      // Create or update snapshot
      await Bun.write(snapshotPath, JSON.stringify(mergedResult, null, 2) + '\n');

      if (!snapshotExists) {
        // If we just created the snapshot, no need to compare
        return;
      }
    }

    // Read and compare with snapshot
    const snapshotContent = await snapshotFile.text();
    const snapshot = JSON.parse(snapshotContent);

    expect(mergedResult).toEqual(snapshot);
  });
}
