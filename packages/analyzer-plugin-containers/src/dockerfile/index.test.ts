import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractDockerfile } from './index.ts';
import { join } from 'node:path';

const glob = new Glob('Dockerfile.*');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

for await (const file of glob.scan({ cwd: fixturesDir })) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const result = await extractDockerfile(content, filePath);
    expect(result).toMatchSnapshot();
  });
}
