import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { z } from "zod";
import type { MarkFileContext } from "../types.ts";
import { mergeResultsV2, createEmptyResultV2 } from "./merge.ts";
import { createDependencyGraph } from "./normalize.ts";
import { rebaseObservationPaths } from "./observation-paths.ts";
import type { AnalyzerResultV2 } from "./types.ts";

export type ExtractionRuntimeOptionsV2 = {
  ignore?: string[];
  /** Stable caller-owned namespace. The default identifies this local analysis directory only. */
  codebaseId?: string;
};

export type FileExtractionContextV2 = {
  codebaseId: string;
  codebasePath: string;
  /** Normalized codebase-relative input path for evidence, graph sources and native locators. */
  relativeFile: string;
};

/** Extractor interface version and serialized result version are independent. */
export type ExtractorV2<Options = unknown> = {
  name: string;
  version: 1;
  extract: (
    codebase: string,
    options?: Partial<Options>,
    runtimeOptions?: ExtractionRuntimeOptionsV2,
  ) => Promise<AnalyzerResultV2>;
  options?: () => Promise<Partial<Options>>;
  optionsSchema?: z.ZodType<Options>;
};

export type FilesExtractorV2<Options = unknown> = {
  name: string;
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string, options: Options) => Promise<void>;
  extractFile: (
    file: string,
    options: Options,
    context: FileExtractionContextV2,
  ) => Promise<AnalyzerResultV2>;
  options?: () => Promise<Partial<Options>>;
  optionsSchema?: z.ZodType<Options>;
};

/**
 * Assemble independent file observations without ever pooling adjacency by PURL. Native graph IDs
 * are namespaced by extractor and input file; node IDs and native locators remain opaque and local.
 */
export function filesExtractorV2<Options = unknown>(
  config: FilesExtractorV2<Options>,
): ExtractorV2<Options> {
  return {
    name: config.name,
    version: config.version,
    ...(config.options !== undefined && { options: config.options }),
    ...(config.optionsSchema !== undefined && { optionsSchema: config.optionsSchema }),
    extract: async (codebase, providedOptions, runtime = {}) => {
      const codebasePath = resolve(codebase);
      const codebaseId =
        runtime.codebaseId ?? `local:${createHash("sha256").update(codebasePath).digest("hex")}`;

      const defaults = config.options ? await config.options() : {};
      const mergedOptions = { ...defaults, ...providedOptions };
      const options = config.optionsSchema
        ? config.optionsSchema.parse(mergedOptions)
        : (mergedOptions as Options);

      const markedFiles = new Set<string>();
      await config.markFiles.call(
        {
          globalIgnorePatterns: runtime.ignore ?? [],
          markFile: (file) =>
            markedFiles.add(isAbsolute(file) ? file : resolve(codebasePath, file)),
        },
        // Match scanFiles() paths without treating literal POSIX backslashes as separators.
        codebasePath.replaceAll(sep, "/"),
        options,
      );

      const results: AnalyzerResultV2[] = [];
      for (const file of [...markedFiles].sort()) {
        const relativeFile = relative(codebasePath, file).replaceAll(sep, "/");

        try {
          const extracted = await config.extractFile(file, options, {
            codebaseId,
            codebasePath,
            relativeFile,
          });
          if (extracted.codebase !== codebaseId) {
            throw new Error("Extractor returned a different codebase namespace");
          }

          const result = rebaseObservationPaths(extracted, codebasePath);
          result.graphs = result.graphs.map((graph) => ({
            ...graph,
            id: JSON.stringify([config.name, relativeFile, graph.id]),
          }));

          // Validate each file observation before aggregation so a broken file remains an issue,
          // rather than aborting the valid graphs collected from other files.
          results.push(mergeResultsV2([result]));
        } catch (error) {
          results.push(failedFileObservation(codebaseId, config.name, relativeFile, error));
        }
      }

      return mergeResultsV2(results, { codebase: codebaseId });
    },
  };
}

function failedFileObservation(
  codebaseId: string,
  extractor: string,
  relativeFile: string,
  error: unknown,
): AnalyzerResultV2 {
  const result = createEmptyResultV2(codebaseId);
  const message = `Failed to extract file: ${error instanceof Error ? error.message : String(error)}`;

  result.issues.push({
    code: "core.file_extraction_failed",
    severity: "ERROR",
    file: relativeFile,
    message,
  });

  // Retain the failed observation: an unreadable file is not evidence of an empty dependency set.
  result.graphs.push(
    createDependencyGraph({
      source: { extractor, files: [relativeFile], key: "extraction-failed" },
      interpretation: "unknown",
      rootCompleteness: "unknown",
      roots: [],
      nodes: [],
      edges: [],
      attributes: { "core:failure": message },
    }),
  );

  return result;
}
