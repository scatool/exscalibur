import { join } from 'node:path';
import { extractCycloneDX } from './index.ts';
import { createFileContentTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createFileContentTests({
  extractFn: extractCycloneDX,
  fixturesDir,
  pattern: '*.cdx.json',
});
