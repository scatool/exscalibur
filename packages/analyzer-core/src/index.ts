export { mergeResults } from './merge.ts';
import { mergeResults } from './merge.ts';

// Export map utilities (generic, not package-manager specific)
export {
  addRelationship,
  ensurePackageExists,
  addPackageEvidence,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  aggregateSubprojectRelationships,
  initializeExtractionMaps,
} from './map-utils.ts';
export type { PackageMapEntry } from './map-utils.ts';

export type Package = {
  purl: string;
  evidence: string[];
};

export type DependencyScope = {
  scope: string;
  packages: string[];
};

export type Subproject = {
  purl: string;
  definitionFile: string;
  scopes: DependencyScope[];
};

export type Relationship = {
  from: string;
  to: string[];
};

export type IssueSeverity = 'HINT' | 'WARNING' | 'ERROR';

export type Issue = {
  message: string;
  severity: IssueSeverity;
  file?: string;
};

export type AnalyzerResult = {
  packages: Package[];
  subprojects: Subproject[];
  relationships: Relationship[];
  issues: Issue[];
};

export type Extractor = {
  name: string;
  version: 1;
  extract: (codebase: string) => Promise<AnalyzerResult>;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
};

export type FilesExtractor = {
  name: string;
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string) => Promise<void>;
  extractFile?: (file: string) => Promise<AnalyzerResult>;
};

/**
 * Normalize and sort an AnalyzerResult
 * - Sorts packages by purl
 * - Sorts subprojects by purl
 * - Sorts relationships by from, then to array
 * - Sorts evidence arrays
 * - Sorts scope packages arrays
 * - Sorts issues by severity, then message
 */
export function normalizeResult(result: AnalyzerResult): AnalyzerResult {
  // Sort packages by purl and their evidence arrays
  const sortedPackages = result.packages
    .map((pkg) => ({
      purl: pkg.purl,
      evidence: [...pkg.evidence].sort(),
    }))
    .sort((a, b) => a.purl.localeCompare(b.purl));

  // Sort subprojects by purl and their scopes
  const sortedSubprojects = result.subprojects
    .map((sub) => ({
      purl: sub.purl,
      definitionFile: sub.definitionFile,
      scopes: sub.scopes
        .map((scope) => ({
          scope: scope.scope,
          packages: [...scope.packages].sort(),
        }))
        .sort((a, b) => a.scope.localeCompare(b.scope)),
    }))
    .sort((a, b) => a.purl.localeCompare(b.purl));

  // Sort relationships by from, and sort their to arrays
  const sortedRelationships = result.relationships
    .map((rel) => ({
      from: rel.from,
      to: [...rel.to].sort(),
    }))
    .sort((a, b) => a.from.localeCompare(b.from));

  // Sort issues by severity (ERROR > WARNING > HINT), then by message, then by file
  const severityOrder: Record<IssueSeverity, number> = { ERROR: 0, WARNING: 1, HINT: 2 };
  const sortedIssues = [...result.issues].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    const messageDiff = a.message.localeCompare(b.message);
    if (messageDiff !== 0) return messageDiff;
    // Sort by file if both exist, otherwise put undefined files last
    if (!a.file && !b.file) return 0;
    if (!a.file) return 1;
    if (!b.file) return -1;
    return a.file.localeCompare(b.file);
  });

  return {
    packages: sortedPackages,
    subprojects: sortedSubprojects,
    relationships: sortedRelationships,
    issues: sortedIssues,
  };
}

export const filesExtractor = (config: FilesExtractor): Extractor => {
  return {
    name: config.name,
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
      const results: AnalyzerResult[] = [];

      for (const file of markedFiles) {
        if (config.extractFile) {
          const fileResult = await config.extractFile(file);
          results.push(fileResult);
        }
      }

      // Merge and normalize all results
      return mergeResults(results);
    },
  };
};
