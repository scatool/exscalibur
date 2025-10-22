import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractDockerfile } from './index.ts';

const glob = new Glob('Dockerfile.*');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

for await (const file of glob.scan({ cwd: fixturesDir, absolute: true })) {
  test(file, async () => {
    const content = await Bun.file(file).text();
    const result = await extractDockerfile(content);
    expect(result).toMatchSnapshot();
  });
}
