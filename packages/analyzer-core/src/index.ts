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

export type Extractor<Options = unknown> = {
  name: string;
  version: 1;
  extract: (codebase: string, options?: Partial<Options>) => Promise<AnalyzerResult>;
  options?: () => Promise<Options>;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
};

export type FilesExtractor<Options = unknown> = {
  name: string;
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string, options: Options) => Promise<void>;
  extractFile?: (file: string, options: Options) => Promise<AnalyzerResult>;
  options?: () => Promise<Options>;
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

  // Sort subprojects by purl, then by definitionFile for stable sorting
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
    .sort((a, b) => {
      const purlCompare = a.purl.localeCompare(b.purl);
      if (purlCompare !== 0) return purlCompare;
      return a.definitionFile.localeCompare(b.definitionFile);
    });

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

export const filesExtractor = <Options = unknown>(config: FilesExtractor<Options>): Extractor<Options> => {
  return {
    name: config.name,
    version: config.version,
    extract: async (codebase: string, runtimeOptions?: Partial<Options>) => {
      const markedFiles: Array<{ relative: string; absolute: string }> = [];

      const context: MarkFileContext = {
        markFile: (file: string) => {
          // Assume file is relative to codebase, convert to absolute for file operations
          const absolutePath = file.startsWith('/') ? file : `${codebase}/${file}`;
          markedFiles.push({ relative: file, absolute: absolutePath });
        },
      };

      const defaultOptions = config.options ? await config.options() : ({} as Options);
      const options = { ...defaultOptions, ...runtimeOptions } as Options;

      // First, mark all relevant files
      await config.markFiles.call(context, codebase, options);

      // Then process each marked file
      const results: AnalyzerResult[] = [];

      for (const file of markedFiles) {
        if (config.extractFile) {
          // Pass absolute path to extractFile for file operations
          const fileResult = await config.extractFile(file.absolute, options);
          // Convert all absolute paths in result to relative paths
          makePathsRelative(fileResult, codebase);
          results.push(fileResult);
        }
      }

      // Merge and normalize all results
      return mergeResults(results);
    },
    ...(config.options !== undefined && { options: config.options }),
  };
};

/**
 * Convert absolute paths to relative paths in an AnalyzerResult.
 * Mutates the result in place.
 */
function makePathsRelative(result: AnalyzerResult, codebase: string): void {
  // Normalize codebase path (remove trailing slash)
  const normalizedCodebase = codebase.endsWith('/') ? codebase.slice(0, -1) : codebase;

  // Convert evidence paths from absolute to relative
  for (const pkg of result.packages) {
    pkg.evidence = pkg.evidence.map((e) => {
      // Evidence format: "path#lineNumber" or just "path"
      const match = e.match(/^(.+?)#(\d+)$/);

      if (match && match[1] && match[2]) {
        // Evidence with line number
        const path = match[1];
        const lineNumber = match[2];
        const relativePath = path.startsWith(normalizedCodebase + '/')
          ? path.substring(normalizedCodebase.length + 1)
          : path;
        return `${relativePath}#${lineNumber}`;
      } else {
        // Evidence without line number (just a path)
        return e.startsWith(normalizedCodebase + '/') ? e.substring(normalizedCodebase.length + 1) : e;
      }
    });
  }

  // Convert subproject definitionFile from absolute to relative
  for (const subproject of result.subprojects) {
    if (subproject.definitionFile.startsWith(normalizedCodebase + '/')) {
      subproject.definitionFile = subproject.definitionFile.substring(normalizedCodebase.length + 1);
    }
  }

  // Convert issue.file from absolute to relative
  for (const issue of result.issues) {
    if (issue.file && issue.file.startsWith(normalizedCodebase + '/')) {
      issue.file = issue.file.substring(normalizedCodebase.length + 1);
    }
  }
}
