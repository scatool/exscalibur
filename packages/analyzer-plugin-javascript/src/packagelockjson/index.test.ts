import { expect, test } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';
import { normalizeResult, scanFixtures } from '@scatool/analyzer-test-utils';

const fixturesDir = `${import.meta.dir}/__fixtures__`;
const fixtures = await scanFixtures(fixturesDir, '*/{package-lock.json,npm-shrinkwrap.json}');

for (const dir of fixtures) {
  test(
    dir,
    async () => {
      const fixturePath = join(fixturesDir, dir);
      const result = await extractor.extract(fixturePath);
      normalizeResult(result, fixturesDir);
      expect(result).toMatchSnapshot();
    },
    { timeout: 30000 }, // npm ls can be slow in CI
  );
}
