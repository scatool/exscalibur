import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'edge-cases', 'monorepo', 'remote-deps', 'workspace'];

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);

    // Normalize paths in evidence and definitionFile for consistent snapshots
    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
    }
    for (const subproject of result.subprojects) {
      subproject.definitionFile = subproject.definitionFile.replace(fixturesDir, '<fixtures>');
    }

    expect(result).toMatchSnapshot();
  });
}
