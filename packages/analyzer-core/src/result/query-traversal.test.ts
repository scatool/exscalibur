import { expect, test } from "vite-plus/test";
import { queryDependencies } from "./query.ts";
import type { AnalyzerResult, DependencyEdge, JsonValue } from "./types.ts";

test("shared views retain distinct path states and evaluator invocation order", () => {
  const project = { purl: "pkg:generic/app", definitionFile: "package.json" };
  const conditionalEdge = (from: string, to: string, expression: string): DependencyEdge => ({
    from,
    to,
    relation: "depends-on",
    status: "resolved",
    selection: "conditional",
    condition: { language: "test", expression },
  });
  const result: AnalyzerResult = {
    formatVersion: 2,
    codebase: "test:traversal",
    subprojects: [project],
    packages: ["shared", "leaf"].map((name) => ({
      purl: `pkg:generic/${name}`,
      evidence: [],
    })),
    issues: [],
    graphs: [
      {
        id: "graph",
        source: { extractor: "test", files: [] },
        interpretation: "locked",
        rootCompleteness: "complete",
        roots: [{ id: "root", project, node: "app", scope: "runtime" }],
        nodes: [
          { id: "app", purl: project.purl, project, dependencyCompleteness: "complete" },
          { id: "shared", purl: "pkg:generic/shared", dependencyCompleteness: "complete" },
          { id: "leaf", purl: "pkg:generic/leaf", dependencyCompleteness: "complete" },
        ],
        edges: [
          conditionalEdge("app", "shared", "a"),
          conditionalEdge("app", "shared", "b"),
          conditionalEdge("shared", "leaf", "c"),
        ],
      },
    ],
  };

  const evaluatedPaths: [string, JsonValue][][] = [];
  const closure = queryDependencies(result, {
    graph: "graph",
    root: "root",
    context: { platform: "test" },
    evaluateCondition: ({ conditions, context, graph, root }) => {
      expect(context).toEqual({ platform: "test" });
      expect(graph.id).toBe("graph");
      expect(root.id).toBe("root");
      evaluatedPaths.push(conditions.map(({ owner, condition }) => [owner, condition.expression]));
      return "unknown";
    },
  });

  // Input edges are considered in order; pending paths are visited depth-first, last-in first-out.
  // Evaluation occurs for the binding and again when the target state is visited.
  expect(evaluatedPaths).toEqual([
    [["app", "a"]],
    [["app", "b"]],
    [["app", "b"]],
    [
      ["app", "b"],
      ["shared", "c"],
    ],
    [
      ["app", "b"],
      ["shared", "c"],
    ],
    [["app", "a"]],
    [
      ["app", "a"],
      ["shared", "c"],
    ],
    [
      ["app", "a"],
      ["shared", "c"],
    ],
  ]);
  expect(closure).toEqual({
    graph: "graph",
    root: "root",
    interpretation: "locked",
    definite: [],
    conditional: ["leaf", "shared"],
    declarations: [],
    completeness: "partial",
  });
});
