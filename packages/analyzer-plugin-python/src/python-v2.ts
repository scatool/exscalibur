import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDependencyGraph,
  filesExtractorV2,
  mergeResultsV2,
  normalizeResultV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type AnalyzerResultV2,
  type FileExtractionContextV2,
} from "@scatool/analyzer-core";
import { optionSchema, type PythonOptions } from "./options.ts";
import { pyprojectResult, requirementsResult } from "./python/declarations.ts";
import { lockResult, pipfileResult } from "./python/locks.ts";

// Keep the established conversion entry points alongside the extractor exports.
export { pyprojectResult, requirementsResult } from "./python/declarations.ts";
export { lockResult, pipfileResult } from "./python/locks.ts";

async function manifestAlongside(
  file: string,
  context: FileExtractionContextV2,
): Promise<AnalyzerResultV2 | undefined> {
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
  convert: (content: string, context: FileExtractionContextV2) => AnalyzerResultV2,
  manifest = false,
) {
  return filesExtractorV2<PythonOptions>({
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
        return declarations ? mergeResultsV2([result, declarations]) : result;
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
        return normalizeResultV2(result);
      }
    },
  });
}

export const requirementsTxtExtractorV2 = extractor(
  "requirementstxt",
  "**/requirements*.txt",
  requirementsResult,
);

export const pyprojectTomlExtractorV2 = extractor(
  "pyprojecttoml",
  "**/pyproject.toml",
  pyprojectResult,
);

export const pipfileLockExtractorV2 = extractor("pipfilelock", "**/Pipfile.lock", pipfileResult);

export const poetryLockExtractorV2 = extractor(
  "poetrylock",
  "**/poetry.lock",
  (content, context) => lockResult(content, context, "poetrylock"),
  true,
);

export const pdmLockExtractorV2 = extractor(
  "pdmlock",
  "**/pdm.lock",
  (content, context) => lockResult(content, context, "pdmlock"),
  true,
);
