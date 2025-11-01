import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractor } from './index.ts';
import { join } from 'node:path';

const fixturesDir = `${import.meta.dir}/__fixtures__`;

// Scan for package-lock.json and npm-shrinkwrap.json files to find fixture directories
const glob = new Glob('*/{package-lock.json,npm-shrinkwrap.json}');
const fixtures = new Set<string>();

for await (const file of glob.scan({ cwd: fixturesDir })) {
  // Extract directory name from path (e.g., "basic/package-lock.json" -> "basic")
  const dir = file.split('/')[0];
  if (dir) {
    fixtures.add(dir);
  }
}

for (const dir of fixtures) {
  test(
    dir,
    async () => {
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
    },
    { timeout: 30000 }, // npm ls can be slow in CI
  );
}
