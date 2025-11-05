import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extractor } from './index.ts';
import { normalizeResult, scanFixtures } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');
const fixtures = await scanFixtures(fixturesDir, '*/yarn.lock');

// Copy fixtures to /tmp to avoid workspace detection issues
let tmpFixturesDir: string;

beforeAll(() => {
  tmpFixturesDir = mkdtempSync(join(tmpdir(), 'yarn-test-'));
  cpSync(fixturesDir, tmpFixturesDir, { recursive: true });
});

afterAll(() => {
  if (tmpFixturesDir) {
    rmSync(tmpFixturesDir, { recursive: true, force: true });
  }
});

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(tmpFixturesDir, dir);
    const result = await extractor.extract(fixturePath);
    normalizeResult(result, tmpFixturesDir);
    expect(result).toMatchSnapshot();
  });
}
