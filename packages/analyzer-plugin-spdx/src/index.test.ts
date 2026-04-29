import { join } from 'node:path';
import { extractSpdx } from './index.ts';
import { createFileContentTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createFileContentTests({
  extractFn: extractSpdx,
  fixturesDir,
  pattern: '*.spdx.{json,jsonld,yaml,yml}',
});
