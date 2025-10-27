import { test, expect } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'monorepo', 'workspace'];

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(fixturesDir, dir);
    const result = await extractor.extract(fixturePath);

    // Normalize paths in evidence and definitionFile for consistent snapshots
    for (const pkg of result.packages) {
      if (pkg.evidence) {
        pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
      }
    }
    if (result.subprojects) {
      for (const subproject of result.subprojects) {
        subproject.definitionFile = subproject.definitionFile.replace(fixturesDir, '<fixtures>');
      }
    }

    result.packages.sort((a, b) => a.purl.localeCompare(b.purl));
    expect(result).toMatchSnapshot();
  });
}
