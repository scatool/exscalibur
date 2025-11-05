import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { extractWorkflow } from './index.ts';
import { normalizeResult, scanFixtureFiles } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');
const fixtureFiles = await scanFixtureFiles(fixturesDir, '*.yml');

for (const file of fixtureFiles) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const result = await extractWorkflow(content, filePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
