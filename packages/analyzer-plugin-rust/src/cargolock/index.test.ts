import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractor } from './index.ts';
import { join } from 'node:path';

const fixturesDir = `${import.meta.dir}/__fixtures__`;

// Scan for Cargo.lock files to find fixture directories
const glob = new Glob('*/Cargo.lock');
const fixtures: string[] = [];

for await (const file of glob.scan({ cwd: fixturesDir })) {
  // Extract directory name from path (e.g., "basic/Cargo.lock" -> "basic")
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

    expect(result).toMatchSnapshot();
  });
}
