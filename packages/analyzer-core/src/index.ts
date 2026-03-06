export type {
  Package,
  DependencyScope,
  Subproject,
  Relationship,
  IssueSeverity,
  Issue,
  AnalyzerResult,
  Extractor,
  MarkFileContext,
  FilesExtractor,
} from './types.ts';
export { normalizeResult } from './normalize.ts';
export { mergeResults } from './merge.ts';
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

import type { AnalyzerResult, Extractor, FilesExtractor, MarkFileContext } from './types.ts';
import { mergeResults } from './merge.ts';
import { Glob } from 'bun';

export async function scanAndMarkFiles(
  context: MarkFileContext,
  codebase: string,
  filePattern: string,
  ignorePatterns: string[],
): Promise<void> {
  const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));
  const glob = new Glob(filePattern);
  for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
    if (!ignoreGlobs.some((g) => g.match(file))) {
      context.markFile(file);
    }
  }
}

export const filesExtractor = <Options = unknown>(config: FilesExtractor<Options>): Extractor<Options> => {
  return {
    name: config.name,
    version: config.version,
    extract: async (codebase: string, runtimeOptions?: Partial<Options>) => {
      const markedFiles: string[] = [];

      const context: MarkFileContext = {
        markFile: (file: string) => {
          const absolutePath = file.startsWith('/') ? file : `${codebase}/${file}`;
          markedFiles.push(absolutePath);
        },
      };

      const defaultOptions = config.options ? await config.options() : ({} as Options);
      const options = { ...defaultOptions, ...runtimeOptions } as Options;

      await config.markFiles.call(context, codebase, options);

      const results: AnalyzerResult[] = [];
      for (const file of markedFiles) {
        if (config.extractFile) {
          const result = await config.extractFile(file, options);
          results.push(result);
        }
      }

      return makePathsRelative(mergeResults(results), codebase);
    },
    ...(config.options !== undefined && { options: config.options }),
  };
};

function makePathsRelative(result: AnalyzerResult, codebase: string): AnalyzerResult {
  const normalizedCodebase = codebase.endsWith('/') ? codebase.slice(0, -1) : codebase;

  // Convert evidence paths from absolute to relative
  for (const pkg of result.packages) {
    pkg.evidence = pkg.evidence.map((e) =>
      e.startsWith(normalizedCodebase + '/') ? e.substring(normalizedCodebase.length + 1) : e,
    );
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

  return result;
}
