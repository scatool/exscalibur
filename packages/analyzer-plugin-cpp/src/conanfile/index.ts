import { type Extractor, filesExtractor } from '@scatool/analyzer-core/src/index.ts';
import { optionsSchema, type ConanOptions } from './options.ts';

// split into separate file to modularize: allow tests to reuse same functions without sharing them
// with the public plugin interface
import { extractFile, markFiles, options } from './conanfile.ts';

export const extractor: Extractor<ConanOptions> = filesExtractor<ConanOptions>({
  name: 'conanfile',
  version: 1,
  options: options,
  optionsSchema: optionsSchema,
  markFiles: markFiles,
  extractFile: extractFile,
});
