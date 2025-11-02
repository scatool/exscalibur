import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { extractDockerfile } from './index.ts';
import { join } from 'node:path';

const glob = new Glob('Dockerfile.*');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

// Collect and sort fixture files for consistent test ordering
const fixtureFiles: string[] = [];
for await (const file of glob.scan({ cwd: fixturesDir })) {
  fixtureFiles.push(file);
}
fixtureFiles.sort();

for (const file of fixtureFiles) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const result = await extractDockerfile(content, filePath);

    // Normalize paths in evidence for consistent snapshots
    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
    }

    expect(result).toMatchSnapshot();
  });
}
