import { test, expect } from 'bun:test';
import { normalizeResult, scanFixtures } from '@scatool/analyzer-test-utils';
import { extractor } from './extractor.ts';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = await scanFixtures(fixturesDir, '*/pom.xml');

for (const dir of fixtures) {
  test(
    dir,
    async () => {
      const fixturePath = join(fixturesDir, dir);
      const result = await extractor.extract(fixturePath);
      normalizeResult(result, fixturesDir);
      expect(result).toMatchSnapshot();
    },
    { timeout: 120000 },
  );
}
