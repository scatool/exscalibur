export type {
  ExternalReference,
  ExternalReferenceType,
  IssueSeverity,
  Issue,
  MarkFileContext,
} from "./types.ts";
export * from "./result-v2/index.ts";
export type {
  AnalyzerResultV2 as AnalyzerResult,
  PackageV2 as Package,
  SubprojectV2 as Subproject,
  ExtractorV2 as Extractor,
  FilesExtractorV2 as FilesExtractor,
  ExtractionRuntimeOptionsV2 as ExtractionRuntimeOptions,
} from "./result-v2/index.ts";
export {
  normalizeResultV2 as normalizeResult,
  mergeResultsV2 as mergeResults,
  createEmptyResultV2 as createEmptyResult,
  validateResultV2 as validateResult,
  parseResultV2 as parseResult,
  queryDependenciesV2 as queryDependencies,
  filesExtractorV2 as filesExtractor,
} from "./result-v2/index.ts";
export {
  findExecutable,
  readNormalizedTextFile,
  readTextFile,
  runCommand,
  scanFiles,
  writeTextFile,
} from "./runtime.ts";
import type { MarkFileContext } from "./types.ts";
import { scanFiles } from "./runtime.ts";

export async function scanAndMarkFiles(
  context: MarkFileContext,
  codebase: string,
  filePattern: string,
  ignorePatterns: string[],
): Promise<void> {
  for (const file of await scanFiles(
    codebase,
    filePattern,
    mergeIgnorePatterns(context, ignorePatterns),
  )) {
    context.markFile(file);
  }
}

export function mergeIgnorePatterns(
  context: MarkFileContext,
  ignorePatterns: string[] = [],
): string[] {
  return [...(context.globalIgnorePatterns ?? []), ...ignorePatterns];
}
