import { createHash } from "node:crypto";
import {
  createDependencyGraph,
  createEmptyResult,
  mergeResults,
  type AnalyzerResult,
  type Extractor,
} from "@scatool/analyzer-core";

/** Every invocation, including failed discovery, contributes an explicit observation. */
export async function analyze(
  codebasePath: string,
  extractors: readonly Extractor[],
  options: Record<string, unknown>,
  ignore: string[],
): Promise<AnalyzerResult> {
  const codebaseId = `local:${createHash("sha256").update(codebasePath).digest("hex")}`;
  const results: AnalyzerResult[] = [];
  for (const extractor of extractors) {
    try {
      const result = await extractor.extract(
        codebasePath.replaceAll("\\", "/"),
        options[extractor.name] as Partial<unknown> | undefined,
        { ignore, codebaseId },
      );
      // Validate each observation and its namespace before combining independent sources.
      results.push(mergeResults([result], { codebase: codebaseId }));
    } catch (error) {
      const result = createEmptyResult(codebaseId);
      const message = `Extractor '${extractor.name}' failed: ${error instanceof Error ? error.message : String(error)}`;
      result.issues.push({ code: "cli.extraction_failed", severity: "ERROR", message });
      result.graphs.push(
        createDependencyGraph({
          source: { extractor: extractor.name, files: [], key: "extraction-failed" },
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
  return mergeResults(results, { codebase: codebaseId });
}
