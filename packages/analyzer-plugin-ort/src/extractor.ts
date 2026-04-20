import { type AnalyzerResult, filesExtractor, scanAndMarkFiles } from '@scatool/analyzer-core/src/index.ts';
import { type OrtAnalyzerResult } from './model.ts';
import { convertOrtResult } from './converter.ts';
import type { OrtOptions } from './options.ts';
import { optionSchema } from './options.ts';

export const extractor = filesExtractor<OrtOptions>({
  name: 'ort',
  version: 1,
  options: async () => ({
    useDefinitionFilePaths: false,
  }),
  optionsSchema: optionSchema,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, '**/analyzer-result.json', []);
  },
  extractFile: async (file, options): Promise<AnalyzerResult> => {
    try {
      const result = (await Bun.file(file).json()) as OrtAnalyzerResult;

      return convertOrtResult(result, {
        evidenceFile: file,
        useDefinitionFilePaths: options?.useDefinitionFilePaths ?? false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: 'ERROR',
            message,
            file,
          },
        ],
      };
    }
  },
});
