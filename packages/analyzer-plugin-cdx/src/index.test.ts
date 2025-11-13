import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { extractCycloneDX } from './index.ts';
import { normalizeResult, scanFixtureFiles } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');
const fixtureFiles = await scanFixtureFiles(fixturesDir, '*.cdx.json');

for (const file of fixtureFiles) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    // Pass relative path to match the extractor's behavior
    const result = await extractCycloneDX(content, file);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
