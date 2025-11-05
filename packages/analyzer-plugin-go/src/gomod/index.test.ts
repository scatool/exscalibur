import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { extractor } from './index.ts';
import { normalizeResult, scanFixtures } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');
const fixtures = await scanFixtures(fixturesDir, '*/go.mod');

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
