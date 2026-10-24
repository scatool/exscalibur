import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  runCommand,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { extractCycloneDXV2 } from "@scatool/analyzer-plugin-cdx";
import { dirname } from "node:path";
import { optionSchema, type UvOptions } from "./options.ts";

/** Import the native frozen UV export; do not reinterpret its SBOM as installed packages. */
export const extractorV2 = filesExtractorV2<UvOptions>({
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
      const result = createEmptyResultV2(context.codebaseId);
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
    const result = extractCycloneDXV2(stdout, {
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
    return normalizeResultV2(result);
  },
});
