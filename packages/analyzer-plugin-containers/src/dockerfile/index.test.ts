import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractDockerfile } from './index.ts';
import { join } from 'node:path';

const glob = new Glob('Dockerfile.*');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

for await (const file of glob.scan({ cwd: fixturesDir })) {
  test(file, async () => {
    const content = await Bun.file(join(fixturesDir, file)).text();
    const result = await extractDockerfile(content);
    expect(result).toMatchSnapshot();
  });
}
