import {
  createDependencyGraph,
  createEmptyResult,
  filesExtractor,
  normalizeResult,
  runCommand,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { extractCycloneDX } from "@scatool/analyzer-plugin-cdx";
import { dirname } from "node:path";
import { optionSchema, type UvOptions } from "./options.ts";

/** Import the native frozen UV export; do not reinterpret its SBOM as installed packages. */
export const extractor = filesExtractor<UvOptions>({
  name: "uv",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/uv.lock", options.ignore);
  },
  extractFile: async (file, options, context) => {
    const { stdout, stderr, exitCode } = await runCommand(
      [options.uvPath, "export", "--format", "cyclonedx1.5", "--frozen", "--no-emit-project"],
      { cwd: dirname(file) },
    );
    if (exitCode !== 0) {
      const result = createEmptyResult(context.codebaseId);
      result.issues.push({
        code: "uv.export_failed",
        severity: "ERROR",
        message: `uv export failed with exit code ${exitCode}: ${stderr}`,
        file: context.relativeFile,
      });
      result.graphs.push(
        createDependencyGraph({
          source: { extractor: "uv", files: [context.relativeFile] },
          interpretation: "unknown",
          rootCompleteness: "unknown",
          roots: [],
          nodes: [],
          edges: [],
        }),
      );
      return result;
    }
    const result = extractCycloneDX(stdout, {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
    });
    result.graphs = result.graphs.map((graph) =>
      createDependencyGraph({
        ...graph,
        source: { ...graph.source, extractor: "uv", tool: { name: "uv" } },
        attributes: {
          ...graph.attributes,
          "uv:export": { format: "cyclonedx1.5", frozen: true, emitProject: false },
        },
      }),
    );
    for (const entry of [...result.packages, ...result.subprojects]) {
      for (const observation of entry.identityObservations ?? [])
        observation.source.extractor = "uv";
    }
    return normalizeResult(result);
  },
});

export type { UvOptions } from "./options.ts";
