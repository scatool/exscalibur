import { canonicalJson, compareStrings, uniqueRecords } from "./json.ts";
import { parseResult } from "./validate.ts";
import type {
  AnalyzerResult,
  Completeness,
  ConditionEvaluator,
  DependencyClosure,
  DependencyEdge,
  JsonObject,
  PathCondition,
  ReachableDeclaration,
} from "./types.ts";

type TraversalState = {
  node: string;
  conditions: PathCondition[];
  unknownSelection: boolean;
};

/**
 * Traverse one exact project/scope entry point in its recorded graph. Results concern that graph's
 * interpretation, not runtime usage or an inferred deployment. Optional selected edges are followed.
 * Native conditions are evaluated as a whole path, with declaring views and environment domains.
 */
export function queryDependencies(
  input: AnalyzerResult,
  options: {
    graph: string;
    root: string;
    /** Explicit query environment; observed graph/root context is separately available to the evaluator. */
    context?: JsonObject;
    evaluateCondition?: ConditionEvaluator;
    /** Maximum distinct path states; exceeding it throws rather than returning a truncated closure. */
    maxStates?: number;
  },
): DependencyClosure {
  const maxStates = options.maxStates ?? 100_000;
  if (!Number.isSafeInteger(maxStates) || maxStates < 1) {
    throw new Error("maxStates must be a positive safe integer");
  }

  const result = parseResult(input);
  const graph = result.graphs.find((item) => item.id === options.graph);
  if (!graph) throw new Error(`Unknown dependency graph: ${options.graph}`);

  const root = graph.roots.find((item) => item.id === options.root);
  if (!root) throw new Error(`Unknown dependency root '${options.root}' in graph '${graph.id}'`);

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingEdges = new Map<string, DependencyEdge[]>();
  for (const edge of graph.edges) {
    const outgoing = outgoingEdges.get(edge.from) ?? [];
    outgoing.push(edge);
    outgoingEdges.set(edge.from, outgoing);
  }

  const definite = new Set<string>();
  const conditional = new Set<string>();
  const declarations: ReachableDeclaration[] = [];
  const visited = new Set<string>();
  const pending: TraversalState[] = [{ node: root.node, conditions: [], unknownSelection: false }];

  // This query concerns an exact root, independently of whether every graph root was enumerated.
  let completeness: Completeness = "complete";
  const lowerCompleteness = (value: Completeness) => {
    if (value === "unknown" || (value === "partial" && completeness === "complete")) {
      completeness = value;
    }
  };

  const evaluatePath = (conditions: PathCondition[]) =>
    conditions.length === 0
      ? "true"
      : (options.evaluateCondition?.({ conditions, context: options.context ?? {}, graph, root }) ??
        "unknown");

  while (pending.length > 0) {
    const state = pending.pop()!;
    // The same view can be reached under different predicates or unknown selections. Visiting
    // only by node ID would lose those paths; identical complete states also terminate cycles.
    const stateKey = canonicalJson(state);
    if (visited.has(stateKey)) continue;
    if (visited.size >= maxStates) {
      throw new Error(
        `Dependency query exceeded maxStates (${maxStates}); no closure was returned`,
      );
    }
    visited.add(stateKey);

    const pathTruth = evaluatePath(state.conditions);
    if (pathTruth === "false") continue;

    const uncertain = state.unknownSelection || pathTruth === "unknown";
    if (state.node !== root.node) {
      (uncertain ? conditional : definite).add(state.node);
    }

    const node = nodes.get(state.node)!;
    lowerCompleteness(node.dependencyCompleteness);

    for (const edge of outgoingEdges.get(state.node) ?? []) {
      // Constraints affect native selection, but never introduce ordinary dependency reachability.
      if (edge.relation !== "depends-on" || edge.selection === "excluded") continue;

      const conditions =
        edge.condition === undefined
          ? state.conditions
          : uniqueRecords([...state.conditions, { owner: edge.from, condition: edge.condition }]);
      const edgeTruth = evaluatePath(conditions);
      if (edgeTruth === "false") continue;

      const unknownSelection = state.unknownSelection || edge.selection === "unknown";
      const conditionalEdge = unknownSelection || edgeTruth === "unknown";
      if (edge.status === "resolved") {
        pending.push({ node: edge.to, conditions, unknownSelection });
      } else {
        declarations.push({
          dependency: edge,
          applicability: conditionalEdge ? "conditional" : "definite",
          conditions,
        });
        lowerCompleteness(edge.status === "declared" ? "unknown" : "partial");
      }
    }
  }

  // A definite path establishes membership even when another path remains conditional.
  const conditionalNodes = [...conditional]
    .filter((node) => !definite.has(node))
    .sort(compareStrings);
  if (conditionalNodes.length > 0) lowerCompleteness("partial");

  return {
    graph: graph.id,
    root: root.id,
    interpretation: graph.interpretation,
    definite: [...definite].sort(compareStrings),
    conditional: conditionalNodes,
    declarations: uniqueRecords(declarations),
    completeness,
  };
}
