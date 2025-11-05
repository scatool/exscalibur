import { expect, test } from 'bun:test';
import { extractDockerfile } from './index.ts';
import { join } from 'node:path';
import { normalizeResult, scanFixtureFiles } from '@scatool/analyzer-test-utils';

const fixturesDir = `${import.meta.dir}/__fixtures__`;
const fixtureFiles = await scanFixtureFiles(fixturesDir, 'Dockerfile.*');

for (const file of fixtureFiles) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const result = await extractDockerfile(content, filePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
