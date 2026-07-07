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
} from "./types.ts";
export { normalizeResult } from "./normalize.ts";
export { mergeResults } from "./merge.ts";
export {
  addRelationship,
  ensurePackageExists,
  addPackageEvidence,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  aggregateSubprojectRelationships,
  initializeExtractionMaps,
  buildResult,
  errorResult,
} from "./map-utils.ts";
export type { PackageMapEntry } from "./map-utils.ts";
export {
  findExecutable,
  readNormalizedTextFile,
  readTextFile,
  runCommand,
  scanFiles,
  writeTextFile,
} from "./runtime.ts";

import type { AnalyzerResult, Extractor, FilesExtractor, MarkFileContext } from "./types.ts";
import { mergeResults } from "./merge.ts";
import { scanFiles } from "./runtime.ts";
import { join } from "node:path/posix";
// it's crucial that we do not use posix variant here for windows to work (e.g. for C:/path)
import { isAbsolute } from "node:path";

export async function scanAndMarkFiles(
  context: MarkFileContext,
  codebase: string,
  filePattern: string,
  ignorePatterns: string[],
): Promise<void> {
  for (const file of await scanFiles(codebase, filePattern, ignorePatterns)) {
    context.markFile(file);
  }
}

export const filesExtractor = <Options = unknown>(
  config: FilesExtractor<Options>,
): Extractor<Options> => {
  return {
    name: config.name,
    version: config.version,
    extract: async (codebase: string, runtimeOptions?: Partial<Options>) => {
      const markedFiles: string[] = [];

      const context: MarkFileContext = {
        markFile: (file: string) => {
          const absolutePath = isAbsolute(file) ? file : join(codebase, file);
          markedFiles.push(absolutePath);
        },
      };

      // Merge option values with the following precedence (highest to lowest):
      // 1. Runtime options provided to the extract function
      // 2. Defaults from config.options() function
      // 3. Defaults from config.optionsSchema
      const defaultOptions = config.options ? await config.options() : ({} as Options);
      let options = { ...defaultOptions, ...runtimeOptions } as Options;
      if (config.optionsSchema) {
        options = config.optionsSchema.parse(options);
      }

      await config.markFiles.call(context, codebase, options);

      const results: AnalyzerResult[] = [];
      for (const file of markedFiles) {
        if (config.extractFile) {
          try {
            const result = await config.extractFile(file, options);
            results.push(result);
          } catch (error) {
            results.push({
              packages: [],
              subprojects: [],
              relationships: [],
              issues: [
                {
                  code: "core.file_extraction_failed",
                  message: `Failed to extract file: ${error instanceof Error ? error.message : String(error)}`,
                  severity: "ERROR",
                  file,
                },
              ],
            });
          }
        }
      }

      return makePathsRelative(mergeResults(results), codebase);
    },
    ...(config.options !== undefined && { options: config.options }),
    ...(config.optionsSchema !== undefined && { optionsSchema: config.optionsSchema }),
  };
};

function makePathsRelative(result: AnalyzerResult, codebase: string): AnalyzerResult {
  const normalizedCodebase = codebase.endsWith("/") ? codebase.slice(0, -1) : codebase;

  // Convert evidence paths from absolute to relative
  for (const pkg of result.packages) {
    pkg.evidence = pkg.evidence.map((e) =>
      e.startsWith(normalizedCodebase + "/") ? e.substring(normalizedCodebase.length + 1) : e,
    );
  }

  // Convert subproject definitionFile from absolute to relative
  for (const subproject of result.subprojects) {
    if (subproject.definitionFile.startsWith(normalizedCodebase + "/")) {
      subproject.definitionFile = subproject.definitionFile.substring(
        normalizedCodebase.length + 1,
      );
    }
  }

  // Convert issue.file from absolute to relative
  for (const issue of result.issues) {
    if (issue.file && issue.file.startsWith(normalizedCodebase + "/")) {
      issue.file = issue.file.substring(normalizedCodebase.length + 1);
    }
  }

  return result;
}
