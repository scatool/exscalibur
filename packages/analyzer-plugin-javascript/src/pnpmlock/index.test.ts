import {test, expect, describe} from 'bun:test';
import {extractor} from './index.ts';
import {join} from 'node:path';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'monorepo', 'workspace'];

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);

    result.packages.sort((a, b) => a.purl.localeCompare(b.purl));
    expect(result).toMatchSnapshot();
  });
}
