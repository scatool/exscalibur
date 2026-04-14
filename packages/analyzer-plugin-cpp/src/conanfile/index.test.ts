import { join } from 'node:path';
import { createExtractorTests } from '@scatool/analyzer-test-utils';
import { filesExtractor } from '@scatool/analyzer-core';
import type { ConanOptions } from './options.ts';
import { extractFile, markFiles, options } from './conanfile.ts';

const fixturesDir = join(import.meta.dir, '__fixtures__');

let extractorWrapper = filesExtractor<ConanOptions>({
  name: 'conanfile-test-wrapper',
  version: 1,
  options: async () => {
    let opts = await options();

    // override profile paths to ensure reproducible test results
    opts.profile_build = join(fixturesDir, 'profile');
    opts.profile_host = join(fixturesDir, 'profile');
    return opts;
  },
  markFiles: markFiles,
  extractFile: async (file: string, options: ConanOptions) => {
    let res = await extractFile(file, options);

    // remove warnings, as they are not stable and not relevant for the tests
    res.issues = res.issues?.filter((issue) => issue.severity !== 'WARNING');

    return res;
  },
});

await createExtractorTests({
  extractor: extractorWrapper,
  fixturesDir,
  pattern: '*/conanfile.{txt,py}',
  timeout: 30000, // transitive example can take a while to analyze
});
