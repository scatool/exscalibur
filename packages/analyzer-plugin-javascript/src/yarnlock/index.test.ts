import { test, expect, beforeAll, afterAll } from 'bun:test';
import { extractor } from './index.ts';
import { join } from 'node:path';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';

const fixturesDir = join(import.meta.dir, './__fixtures__');
const fixtures = ['basic'];

// Copy fixtures to /tmp to avoid workspace detection issues
let tmpFixturesDir: string;

beforeAll(() => {
  tmpFixturesDir = mkdtempSync(join(tmpdir(), 'yarn-test-'));
  cpSync(fixturesDir, tmpFixturesDir, { recursive: true });
});

afterAll(() => {
  if (tmpFixturesDir) {
    rmSync(tmpFixturesDir, { recursive: true, force: true });
  }
});

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(tmpFixturesDir, dir);
    const result = await extractor.extract(fixturePath);

    // Normalize paths in evidence and definitionFile for consistent snapshots
    for (const pkg of result.packages) {
      if (pkg.evidence) {
        pkg.evidence = pkg.evidence.map((e) => e.replace(tmpFixturesDir, '<fixtures>'));
      }
    }
    if (result.subprojects) {
      for (const subproject of result.subprojects) {
        subproject.definitionFile = subproject.definitionFile.replace(tmpFixturesDir, '<fixtures>');
      }
    }

    result.packages.sort((a, b) => a.purl.localeCompare(b.purl));
    expect(result).toMatchSnapshot();
  });
}
