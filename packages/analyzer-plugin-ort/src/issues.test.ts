import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { extractor } from './extractor.ts';
import { normalizeResult } from '@scatool/analyzer-test-utils';
import { Glob } from 'bun';

const fixturesDir = join(import.meta.dir, '__fixtures__');

// Scan for issues fixtures (need custom logic for nested directory structure)
const glob = new Glob('issues/*/analyzer-result.json');
const fixtures: string[] = [];

for await (const file of glob.scan({ cwd: fixturesDir })) {
  // Extract "issues/various-severities" from "issues/various-severities/analyzer-result.json"
  const dir = file.substring(0, file.lastIndexOf('/'));
  fixtures.push(dir);
}

fixtures.sort();

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
