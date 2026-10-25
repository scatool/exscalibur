export type {
  ExternalReference,
  ExternalReferenceType,
  IssueSeverity,
  Issue,
  MarkFileContext,
} from "./types.ts";
export * from "./result/index.ts";
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
