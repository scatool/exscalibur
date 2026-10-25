import { sep } from "node:path";
import type { AnalyzerResultV2 } from "./types.ts";

/**
 * Rebase path-bearing observation fields without interpreting native locators or arbitrary metadata.
 * Clone first: adapters may share project and artifact objects with their source observations.
 */
export function rebaseObservationPaths(
  input: AnalyzerResultV2,
  codebasePath: string,
): AnalyzerResultV2 {
  const result = structuredClone(input);
  const codebasePrefix = `${codebasePath.replaceAll(sep, "/").replace(/\/$/, "")}/`;
  const rebasePath = (value: string) => {
    // Only native separators are normalized; a backslash is a literal filename character on POSIX.
    const normalized = value.replaceAll(sep, "/");
    return normalized.startsWith(codebasePrefix)
      ? normalized.slice(codebasePrefix.length)
      : normalized;
  };
  const rebaseEvidence = (values: string[] | undefined) => values?.map(rebasePath);

  for (const pkg of result.packages) {
    pkg.evidence = rebaseEvidence(pkg.evidence)!;

    for (const observation of pkg.identityObservations ?? []) {
      observation.source.files = rebaseEvidence(observation.source.files)!;
    }
    for (const artifact of pkg.artifacts ?? []) {
      artifact.evidence = rebaseEvidence(artifact.evidence)!;
    }
  }

  for (const project of result.subprojects) {
    project.definitionFile = rebasePath(project.definitionFile);
    if (project.evidence) project.evidence = rebaseEvidence(project.evidence);

    for (const observation of project.identityObservations ?? []) {
      observation.source.files = rebaseEvidence(observation.source.files)!;
    }
  }

  for (const graph of result.graphs) {
    graph.source.files = graph.source.files.map(rebasePath);

    for (const node of graph.nodes) {
      if (node.project) node.project.definitionFile = rebasePath(node.project.definitionFile);
      if (node.evidence) node.evidence = rebaseEvidence(node.evidence);

      for (const artifact of node.artifacts ?? []) {
        artifact.evidence = rebaseEvidence(artifact.evidence)!;
      }
    }

    for (const root of graph.roots) {
      root.project.definitionFile = rebasePath(root.project.definitionFile);
      if (root.evidence) root.evidence = rebaseEvidence(root.evidence);
    }

    for (const dependency of graph.edges) {
      if (dependency.evidence) dependency.evidence = rebaseEvidence(dependency.evidence);
    }
  }

  for (const issue of result.issues) {
    if (issue.file) issue.file = rebasePath(issue.file);
  }

  return result;
}
