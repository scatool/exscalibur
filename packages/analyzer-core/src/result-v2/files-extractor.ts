import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { z } from "zod";
import type { MarkFileContext } from "../types.ts";
import { mergeResultsV2, createEmptyResultV2 } from "./merge.ts";
import { createDependencyGraph } from "./normalize.ts";
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
    extract: async (codebase, provided, runtime = {}) => {
      const codebasePath = resolve(codebase);
      const codebaseId =
        runtime.codebaseId ?? `local:${createHash("sha256").update(codebasePath).digest("hex")}`;
      const defaults = config.options ? await config.options() : {};
      const mergedOptions = { ...defaults, ...provided };
      const options = config.optionsSchema
        ? config.optionsSchema.parse(mergedOptions)
        : (mergedOptions as Options);
      const marked = new Set<string>();
      await config.markFiles.call(
        {
          globalIgnorePatterns: runtime.ignore ?? [],
          markFile: (file) => marked.add(isAbsolute(file) ? file : resolve(codebasePath, file)),
        },
        codebasePath,
        options,
      );

      const results: AnalyzerResultV2[] = [];
      for (const file of [...marked].sort()) {
        const relativeFile = relative(codebasePath, file).replaceAll("\\", "/");
        try {
          const extracted = await config.extractFile(file, options, {
            codebaseId,
            codebasePath,
            relativeFile,
          });
          if (extracted.codebase !== codebaseId)
            throw new Error("Extractor returned a different codebase namespace");
          const result = rebasePaths(extracted, codebasePath);
          result.graphs = result.graphs.map((graph) => ({
            ...graph,
            id: JSON.stringify([config.name, relativeFile, graph.id]),
          }));
          // Validate each file observation before aggregation so a broken file remains an issue,
          // rather than aborting the valid graphs collected from other files.
          results.push(mergeResultsV2([result]));
        } catch (error) {
          const result = createEmptyResultV2(codebaseId);
          const message = `Failed to extract file: ${error instanceof Error ? error.message : String(error)}`;
          result.issues.push({
            code: "core.file_extraction_failed",
            severity: "ERROR",
            file: relativeFile,
            message,
          });
          result.graphs.push(
            createDependencyGraph({
              source: { extractor: config.name, files: [relativeFile], key: "extraction-failed" },
              interpretation: "unknown",
              rootCompleteness: "unknown",
              roots: [],
              nodes: [],
              edges: [],
              attributes: { "core:failure": message },
            }),
          );
          results.push(result);
        }
      }
      return mergeResultsV2(results, { codebase: codebaseId });
    },
  };
}

function rebasePaths(input: AnalyzerResultV2, codebase: string): AnalyzerResultV2 {
  const result = structuredClone(input);
  const prefix = `${codebase.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  const rebase = (value: string) => {
    const normalized = value.replaceAll("\\", "/");
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  };
  const evidence = (values: string[] | undefined) => values?.map(rebase);
  for (const pkg of result.packages) {
    pkg.evidence = evidence(pkg.evidence)!;
    for (const artifact of pkg.artifacts ?? []) artifact.evidence = evidence(artifact.evidence)!;
  }
  for (const project of result.subprojects) {
    project.definitionFile = rebase(project.definitionFile);
    if (project.evidence) project.evidence = evidence(project.evidence);
  }
  for (const graph of result.graphs) {
    graph.source.files = graph.source.files.map(rebase);
    for (const node of graph.nodes) {
      if (node.project) node.project.definitionFile = rebase(node.project.definitionFile);
      if (node.evidence) node.evidence = evidence(node.evidence);
      for (const artifact of node.artifacts ?? []) artifact.evidence = evidence(artifact.evidence)!;
    }
    for (const root of graph.roots) {
      root.project.definitionFile = rebase(root.project.definitionFile);
      if (root.evidence) root.evidence = evidence(root.evidence);
    }
    for (const dependency of graph.edges) {
      if (dependency.evidence) dependency.evidence = evidence(dependency.evidence);
    }
  }
  for (const issue of result.issues) if (issue.file) issue.file = rebase(issue.file);
  return result;
}
