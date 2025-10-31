import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { resolve } from 'path';

test('package.json extractor should extract package URLs from package.json', async () => {
  // Path to the test fixture
  const fixturesDir = resolve(import.meta.dir, './__fixtures__');
  const fixturePath = resolve(fixturesDir, 'simple');

  // Run the extractor
  const result = await extractor.extract(fixturePath);

  // Verify the structure
  expect(result).toHaveProperty('packages');
  expect(Array.isArray(result.packages)).toBe(true);

  // Normalize paths in evidence for consistent snapshots
  for (const pkg of result.packages) {
    pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
  }

  // Snapshot test
  expect(result).toMatchSnapshot();
});
