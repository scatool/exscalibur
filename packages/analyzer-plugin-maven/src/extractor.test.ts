import { join } from 'node:path/posix';
import { extractor } from './extractor.ts';
import { createExtractorTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: '*/pom.xml',
  timeout: 120000,
});
