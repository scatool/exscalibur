import { join } from 'node:path';
import { createExtractorTests } from '@scatool/analyzer-test-utils';
import { filesExtractor } from '@scatool/analyzer-core';
import { type ConanOptions, optionsSchema } from './options.ts';
import { extractFile, markFiles } from './conanfile.ts';

const fixturesDir = join(import.meta.dir, '__fixtures__');

const extractorWrapper = filesExtractor<ConanOptions>({
  name: 'conanfile-test-wrapper',
  version: 1,
  options: async () => {
    // override profile paths to ensure reproducible test results
    return {
      profile_build: join(fixturesDir, 'profile'),
      profile_host: join(fixturesDir, 'profile'),
    };
  },
  optionsSchema: optionsSchema,
  markFiles: markFiles,
  extractFile: async (file: string, options: ConanOptions) => {
    const res = await extractFile(file, options);

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
