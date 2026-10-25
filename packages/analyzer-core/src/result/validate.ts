import { isPortableJson } from "./json.ts";
import { analyzerResultSchema } from "./result-schema.ts";
import type {
  AnalyzerResult,
  DependencyGraph,
  Package,
  ProjectReference,
  Subproject,
} from "./types.ts";

export { analyzerResultSchema } from "./result-schema.ts";

export function projectKey(project: ProjectReference): string {
  return JSON.stringify([project.purl, project.definitionFile]);
}

/** Validate serialized input, retain additive fields, and check all graph-local references. */
export function parseResult(value: unknown): AnalyzerResult {
  if (!isPortableJson(value)) throw new Error("Analyzer results must contain plain JSON data only");
  analyzerResultSchema.parse(value);

  // Some schema libraries omit __proto__ for safe object construction. It is a valid JSON data
  // key, so validate first and clone the original data rather than using a transformed schema result.
  const result = structuredClone(value) as AnalyzerResult;
  validateReferences(result);

  return result;
}

export function validateResult(result: AnalyzerResult): void {
  parseResult(result);
}

function indexUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  subject: string,
): Map<string, T> {
  const mapping = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (mapping.has(id)) throw new Error(`Duplicate ${subject}: ${id}`);
    mapping.set(id, item);
  }

  return mapping;
}

function validateReferences(result: AnalyzerResult): void {
  const packagesByPurl = indexUnique(result.packages, (item) => item.purl, "package PURL");
  const projectsByKey = indexUnique(result.subprojects, projectKey, "project/subject");
  indexUnique(result.graphs, (graph) => graph.id, "graph ID");

  for (const graph of result.graphs) {
    validateGraphReferences(graph, packagesByPurl, projectsByKey);
  }
}

function validateGraphReferences(
  graph: DependencyGraph,
  packagesByPurl: ReadonlyMap<string, Package>,
  projectsByKey: ReadonlyMap<string, Subproject>,
): void {
  const viewsById = indexUnique(graph.nodes, (node) => node.id, `view ID in graph '${graph.id}'`);
  indexUnique(graph.roots, (root) => root.id, `root ID in graph '${graph.id}'`);

  for (const node of graph.nodes) {
    if (node.project) {
      if (node.project.purl !== node.purl || !projectsByKey.has(projectKey(node.project))) {
        throw new Error(
          `View '${node.id}' in graph '${graph.id}' references an unknown or inconsistent project/subject`,
        );
      }
    } else if (!packagesByPurl.has(node.purl)) {
      throw new Error(
        `View '${node.id}' in graph '${graph.id}' references an unknown package: ${node.purl}`,
      );
    }
  }

  for (const root of graph.roots) {
    const node = viewsById.get(root.node);
    if (
      !projectsByKey.has(projectKey(root.project)) ||
      !node?.project ||
      projectKey(root.project) !== projectKey(node.project)
    ) {
      throw new Error(
        `Root '${root.id}' in graph '${graph.id}' must reference its exact project/subject's view`,
      );
    }
  }

  for (const dependency of graph.edges) {
    if (!viewsById.has(dependency.from)) {
      throw new Error(
        `Dependency in graph '${graph.id}' has an unknown source view: ${dependency.from}`,
      );
    }
    if (dependency.status === "resolved" && !viewsById.has(dependency.to)) {
      throw new Error(
        `Dependency in graph '${graph.id}' has an unknown target view: ${dependency.to}`,
      );
    }
  }
}
