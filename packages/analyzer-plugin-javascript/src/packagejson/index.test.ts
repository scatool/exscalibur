import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { resolve } from 'path';
import { normalizeResult } from '@scatool/analyzer-test-utils';

test('package.json extractor should extract package URLs from package.json', async () => {
  // Path to the test fixture
  const fixturesDir = resolve(import.meta.dir, './__fixtures__');
  const fixturePath = resolve(fixturesDir, 'simple');

  // Run the extractor
  const result = await extractor.extract(fixturePath);

  // Verify the structure
  expect(result).toHaveProperty('packages');
  expect(Array.isArray(result.packages)).toBe(true);

  normalizeResult(result, fixturesDir);

  // Snapshot test
  expect(result).toMatchSnapshot();
});
