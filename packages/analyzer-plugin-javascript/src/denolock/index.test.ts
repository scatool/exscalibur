import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';
import { normalizeResult } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'edge-cases', 'monorepo', 'remote-deps', 'workspace'];

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
