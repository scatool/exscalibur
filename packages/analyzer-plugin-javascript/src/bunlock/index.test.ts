import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractor } from './index.ts';
import { join } from 'node:path';

const fixturesDir = `${import.meta.dir}/__fixtures__`;

// Scan for bun.lock files to find fixture directories
const glob = new Glob('*/bun.lock');
const fixtures: string[] = [];

for await (const file of glob.scan({ cwd: fixturesDir })) {
  // Extract directory name from path (e.g., "react/bun.lock" -> "react")
  const dir = file.split('/')[0];
  if (dir) {
    fixtures.push(dir);
  }
}

// Sort fixtures alphabetically for consistent test ordering
fixtures.sort();

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);

    // Normalize paths in evidence and definitionFile for consistent snapshots
    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
    }
    for (const subproject of result.subprojects) {
      subproject.definitionFile = subproject.definitionFile.replace(fixturesDir, '<fixtures>');
    }

    expect(result).toMatchSnapshot();
  });
}
