export type Subproject = {
  purl: string;
  definitionFile: string;
};

export type AnalyzerResult = {
  packages: string[];
  subprojects?: Subproject[];
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
  return {
    version: config.version,
    extract: async (codebase: string) => {
      const markedFiles: string[] = [];

      const context: MarkFileContext = {
        markFile: (file: string) => {
          markedFiles.push(file);
        },
      };

      // First, mark all relevant files
      await config.markFiles.call(context, codebase);

      // Then process each marked file
      const allPackages: string[] = [];
      const allSubprojects: Subproject[] = [];

      for (const file of markedFiles) {
        if (config.extractFile) {
          const fileResult = await config.extractFile(file);
          allPackages.push(...fileResult.packages);
          if (fileResult.subprojects) {
            allSubprojects.push(...fileResult.subprojects);
          }
        }
      }

      // Remove duplicate packages
      const result: AnalyzerResult = {
        packages: [...new Set(allPackages)],
      };

      // Add subprojects if any were found
      if (allSubprojects.length > 0) {
        result.subprojects = allSubprojects;
      }

      return result;
    },
  };
};
