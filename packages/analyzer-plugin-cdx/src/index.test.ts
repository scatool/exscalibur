import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractCycloneDX } from './index.ts';
import { join } from 'node:path';

const glob = new Glob('*.cdx.json');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

for await (const file of glob.scan({ cwd: fixturesDir })) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const result = await extractCycloneDX(content, filePath);

    // Normalize paths in evidence for consistent snapshots
    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
    }

    expect(result).toMatchSnapshot();
  });
}
