import { test, expect, beforeAll, afterAll } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { normalizeResult } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'git-deps', 'monorepo', 'tarball-deps', 'workspace'];

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
