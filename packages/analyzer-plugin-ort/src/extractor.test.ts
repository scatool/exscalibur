import { join } from 'node:path';
import { extractor } from './extractor.ts';
import { createExtractorTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: '*/*/analyzer-result.{json,yml,yaml}',
  useFiles: true,
  extractDirectory: true,
});
