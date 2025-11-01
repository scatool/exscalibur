import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { convertSPDXToAnalyzerResult, type SPDXDocument } from './index.ts';
import { join } from 'node:path';
import { normalizeResult } from '@scatool/analyzer-core/src/index.ts';

const glob = new Glob('*.spdx.json');
const fixturesDir = `${import.meta.dir}/__fixtures__`;

for await (const file of glob.scan({ cwd: fixturesDir })) {
  test(file, async () => {
    const filePath = join(fixturesDir, file);
    const content = await Bun.file(filePath).text();
    const spdxDoc: SPDXDocument = JSON.parse(content);

    // Convert using a mock codebase path
    const mockCodebase = '/project';
    const result = convertSPDXToAnalyzerResult(spdxDoc, mockCodebase);

    // Normalize paths in evidence for consistent snapshots
    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(mockCodebase, '<project>'));
    }

    // Normalize and sort the result for consistent snapshots
    const normalizedResult = normalizeResult(result);

    expect(normalizedResult).toMatchSnapshot();
  });
}
