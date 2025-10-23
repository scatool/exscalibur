export type Package = {
  purl: string;
  evidence?: string[];
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

export type Relationship = {
  from: string;
  to: string[];
};

export type AnalyzerResult = {
  packages: Package[];
  subprojects?: Subproject[];
  relationships?: Relationship[];
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
      const allPackages: Package[] = [];
      const allSubprojects: Subproject[] = [];
      const allRelationships: Relationship[] = [];

      for (const file of markedFiles) {
        if (config.extractFile) {
          const fileResult = await config.extractFile(file);
          allPackages.push(...fileResult.packages);
          if (fileResult.subprojects) {
            allSubprojects.push(...fileResult.subprojects);
          }
          if (fileResult.relationships) {
            allRelationships.push(...fileResult.relationships);
          }
        }
      }

      // Merge duplicate packages and combine evidence arrays
      const packageMap = new Map<string, Package>();
      for (const pkg of allPackages) {
        const existing = packageMap.get(pkg.purl);
        if (existing) {
          // Merge evidence arrays
          if (pkg.evidence) {
            if (existing.evidence) {
              existing.evidence.push(...pkg.evidence);
            } else {
              existing.evidence = [...pkg.evidence];
            }
          }
        } else {
          // Create new entry with evidence array (if present)
          const newPkg: Package = { purl: pkg.purl };
          if (pkg.evidence) {
            newPkg.evidence = [...pkg.evidence];
          }
          packageMap.set(pkg.purl, newPkg);
        }
      }
      // Merge relationships with the same 'from' value
      const relationshipMap = new Map<string, Set<string>>();
      for (const rel of allRelationships) {
        const existing = relationshipMap.get(rel.from);
        if (existing) {
          for (const to of rel.to) {
            existing.add(to);
          }
        } else {
          relationshipMap.set(rel.from, new Set(rel.to));
        }
      }

      const result: AnalyzerResult = {
        packages: Array.from(packageMap.values()),
      };

      // Add subprojects if any were found
      if (allSubprojects.length > 0) {
        result.subprojects = allSubprojects;
      }

      // Add relationships if any were found
      if (relationshipMap.size > 0) {
        result.relationships = Array.from(relationshipMap.entries()).map(([from, toSet]) => ({
          from,
          to: Array.from(toSet),
        }));
      }

      return result;
    },
  };
};
