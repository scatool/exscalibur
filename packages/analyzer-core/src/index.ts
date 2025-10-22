export type AnalyzerResult = {
  packages: string[];
};

export type Extractor = {
  version: 1;
  extract: (codebase: string) => Promise<AnalyzerResult>;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
};

export type FilesExtractor = {
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string) => Promise<void>;
  extractFile?: (file: string) => Promise<AnalyzerResult>;
};

export const filesExtractor = (config: FilesExtractor): Extractor => {
  const markedFiles: string[] = [];

  const context: MarkFileContext = {
    markFile: (file: string) => {
      markedFiles.push(file);
    },
  };

  return {
    version: config.version,
    extract: async (codebase: string) => {
      // First, mark all relevant files
      await config.markFiles.call(context, codebase);

      // Then process each marked file
      const results: AnalyzerResult = {
        packages: [],
      };

      for (const file of markedFiles) {
        if (config.extractFile) {
          const fileResult = await config.extractFile(file);
          results.packages.push(...fileResult.packages);
        }
      }

      return results;
    },
  };
};
