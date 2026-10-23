import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type AnalyzerResultV2,
  type DependencyEdge,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";

export const extractorV2 = filesExtractorV2({
  name: "dockerfile",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/Dockerfile*", []);
  },
  extractFile: async (file, _options, context) =>
    extractDockerfileV2(
      await readNormalizedTextFile(file),
      context.relativeFile,
      context.codebaseId,
    ),
});

/** FROM records declare build inputs; they do not resolve image contents or a selected build target. */
export function extractDockerfileV2(
  content: string,
  filePath = "Dockerfile",
  codebase = "input:dockerfile",
): AnalyzerResultV2 {
  const result = createEmptyResultV2(codebase);
  const project = {
    purl: new PackageURL("generic", "dockerfile", "build", null, null, null).toString(),
    definitionFile: filePath,
  };
  result.subprojects.push({
    ...project,
    evidence: [filePath],
    identityObservations: [
      { source: { extractor: "dockerfile", files: [filePath] }, synthesizedPurl: true },
    ],
  });
  const edges: DependencyEdge[] = [];
  const stages = new Set<string>();
  const argDefaults: { name: string; value: string; line: number }[] = [];
  let partial = false;
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    const arg = /^\s*ARG\s+([A-Z_][A-Z0-9_]*)=(.+?)(?:\s*#.*)?$/i.exec(line);
    if (arg) argDefaults.push({ name: arg[1]!, value: arg[2]!.trim(), line: index + 1 });
    if (!/^\s*FROM\b/i.test(line)) continue;
    const match = /^\s*FROM\s+(?:--platform=(\S+)\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*(?:#.*)?$/i.exec(
      line,
    );
    if (!match || /[\\`]\s*$/.test(line)) {
      partial = true;
      result.issues.push({
        code: "UNSUPPORTED_FROM",
        severity: "WARNING",
        message: "FROM instruction could not be fully parsed",
        file: `${filePath}#${index + 1}`,
      });
      continue;
    }
    const [, platform, reference, stage] = match;
    if (reference !== "scratch" && !stages.has(reference!.toLowerCase())) {
      edges.push({
        from: "source",
        relation: "depends-on",
        status: "declared",
        selection: "selected",
        kind: "FROM",
        requested: { name: reference!, specifier: reference! },
        evidence: [`${filePath}#${index + 1}`],
        attributes: {
          "dockerfile:line": index + 1,
          ...(platform && { "dockerfile:platform": platform }),
          ...(stage && { "dockerfile:stage": stage }),
        },
      });
    }
    if (stage) stages.add(stage.toLowerCase());
  }
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "dockerfile", files: [filePath] },
      interpretation: "declared",
      context: { "dockerfile:argDefaults": argDefaults },
      rootCompleteness: "complete",
      roots: [{ id: "from", project, scope: "from", node: "source" }],
      nodes: [
        {
          id: "source",
          purl: project.purl,
          project,
          dependencyCompleteness: partial ? "partial" : "complete",
        },
      ],
      edges,
    }),
  );
  return normalizeResultV2(result);
}
