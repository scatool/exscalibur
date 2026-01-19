import { join } from 'node:path';
import { extractor } from './index.ts';
import { createExtractorTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: '*/pnpm-lock.yaml',
});
