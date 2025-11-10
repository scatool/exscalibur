import { test, expect } from 'bun:test';
import { extractor } from './extractor.ts';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic', 'multimodule'];

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
    for (const issue of result.issues) {
      if (issue.file) {
        issue.file = issue.file.replace(fixturesDir, '<fixtures>');
      }
    }

    expect(result).toMatchSnapshot();
  });
}
