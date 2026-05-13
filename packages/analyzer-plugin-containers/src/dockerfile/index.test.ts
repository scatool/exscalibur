import { join } from 'node:path/posix';
import { extractDockerfile } from './index.ts';
import { createFileContentTests } from '@scatool/analyzer-test-utils';

const fixturesDir = join(import.meta.dir, '__fixtures__');

await createFileContentTests({
  extractFn: extractDockerfile,
  fixturesDir,
  pattern: 'Dockerfile.*',
});
