import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { resolve } from 'path';

test('package.json extractor should extract package URLs from package.json', async () => {
  // Path to the test fixture
  const fixturePath = resolve(import.meta.dir, './__fixtures__/simple');

  // Run the extractor
  const result = await extractor.extract(fixturePath);

  // Verify the structure
  expect(result).toHaveProperty('packages');
  expect(Array.isArray(result.packages)).toBe(true);

  // Sort packages for consistent snapshot comparison
  result.packages.sort((a, b) => a.purl.localeCompare(b.purl));

  // Snapshot test
  expect(result).toMatchSnapshot();
});
