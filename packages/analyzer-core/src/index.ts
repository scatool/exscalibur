export type Package = {
  purl: string;
};

export type DependencyScope = {
  scope: string;
  packages: string[];
};

export type Subproject = {
  purl: string;
  definitionFile: string;
  scopes?: DependencyScope[];
};

export type AnalyzerResult = {
  packages: Package[];
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
      const allPackagePurls: string[] = [];
      const allSubprojects: Subproject[] = [];

      for (const file of markedFiles) {
        if (config.extractFile) {
          const fileResult = await config.extractFile(file);
          allPackagePurls.push(...fileResult.packages.map(p => p.purl));
          if (fileResult.subprojects) {
            allSubprojects.push(...fileResult.subprojects);
          }
        }
      }

      // Remove duplicate packages and convert to Package objects
      const uniquePurls = [...new Set(allPackagePurls)];
      const result: AnalyzerResult = {
        packages: uniquePurls.map(purl => ({ purl })),
      };

      // Add subprojects if any were found
      if (allSubprojects.length > 0) {
        result.subprojects = allSubprojects;
      }

      return result;
    },
  };
};
