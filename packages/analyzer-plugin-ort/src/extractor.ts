import { type AnalyzerResult, filesExtractor } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { type OrtAnalyzerResult } from './model.ts';
import { convertOrtResult } from './converter.ts';

export interface OrtExtractorOptions {
  /**
   * If true, use the definition_file_path from ORT projects as evidence (e.g., package.json, build.gradle).
   * If false (default), use the analyzer-result.json file as evidence.
   */
  useDefinitionFilePaths: boolean;
}

export const extractor = filesExtractor<OrtExtractorOptions>({
  name: 'ort',
  version: 1,
  options: async () => ({
    useDefinitionFilePaths: false,
  }),
  markFiles: async function (codebase) {
    const glob = new Glob('**/analyzer-result.json');
    for await (const file of glob.scan({ cwd: codebase, absolute: true })) {
      this.markFile(file);
    }
  },
  extractFile: async (file, options): Promise<AnalyzerResult> => {
    try {
      const result = (await Bun.file(file).json()) as OrtAnalyzerResult;

      return convertOrtResult(result, {
        evidenceFile: file,
        useDefinitionFilePaths: options.useDefinitionFilePaths,
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
