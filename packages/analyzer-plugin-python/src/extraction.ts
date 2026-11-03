import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDependencyGraph,
  filesExtractor,
  mergeResults,
  normalizeResult,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type AnalyzerResult,
  type FileExtractionContext,
} from "@scatool/analyzer-core";
import { optionSchema, type PythonOptions } from "./options.ts";
import { pyprojectResult, requirementsResult } from "./python/declarations.ts";
import { lockResult, pipfileResult } from "./python/locks.ts";

// Keep the established conversion entry points alongside the extractor exports.
export { pyprojectResult, requirementsResult } from "./python/declarations.ts";
export { lockResult, pipfileResult } from "./python/locks.ts";

async function manifestAlongside(
  file: string,
  context: FileExtractionContext,
): Promise<AnalyzerResult | undefined> {
  const path = join(dirname(file), "pyproject.toml");
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  return pyprojectResult(content, {
    ...context,
    relativeFile: join(dirname(context.relativeFile), "pyproject.toml"),
  });
}

function extractor(
  name: string,
  glob: string,
  convert: (content: string, context: FileExtractionContext) => AnalyzerResult,
  manifest = false,
) {
  return filesExtractor<PythonOptions>({
    name,
    version: 1,
    optionsSchema: optionSchema,
    markFiles: async function (codebase, options) {
      await scanAndMarkFiles(this, codebase, glob, options.ignore);
    },
    extractFile: async (file, _options, context) => {
      const result = convert(await readNormalizedTextFile(file), context);
      if (!manifest) return result;

      // Current declarations are independent: their failure must not erase a valid lock.
      try {
        const declarations = await manifestAlongside(file, context);
        return declarations ? mergeResults([result, declarations]) : result;
      } catch (error) {
        const definitionFile = join(dirname(context.relativeFile), "pyproject.toml");
        result.issues.push({
          code: `${name}.manifest_failed`,
          severity: "ERROR",
          file: definitionFile,
          message: `Unable to read current declarations: ${error instanceof Error ? error.message : String(error)}`,
        });
        result.graphs.push(
          createDependencyGraph({
            source: { extractor: "pyprojecttoml", files: [definitionFile] },
            interpretation: "unknown",
            rootCompleteness: "unknown",
            roots: [],
            nodes: [],
            edges: [],
          }),
        );
        return normalizeResult(result);
      }
    },
  });
}

export const requirementsTxtExtractor = extractor(
  "requirementstxt",
  "**/requirements*.txt",
  requirementsResult,
);

export const pyprojectTomlExtractor = extractor(
  "pyprojecttoml",
  "**/pyproject.toml",
  pyprojectResult,
);

export const pipfileLockExtractor = extractor("pipfilelock", "**/Pipfile.lock", pipfileResult);

export const poetryLockExtractor = extractor(
  "poetrylock",
  "**/poetry.lock",
  (content, context) => lockResult(content, context, "poetrylock"),
  true,
);

export const pdmLockExtractor = extractor(
  "pdmlock",
  "**/pdm.lock",
  (content, context) => lockResult(content, context, "pdmlock"),
  true,
);
