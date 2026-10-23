import { expect, test } from "vite-plus/test";
import { parseResultV2, queryDependenciesV2 } from "@scatool/analyzer-core";
import { extractWorkflowV2 } from "./index-v2.ts";

test("workflow declarations preserve job-local predicates and unresolved action internals", () => {
  const result = extractWorkflowV2(
    `jobs:
  build:
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
        if: success()
      - uses: docker://alpine:3
  test:
    steps:
      - uses: actions/checkout@v3
`,
    ".github/workflows/test.yml",
    "repo",
  );
  expect(parseResultV2(result)).toEqual(result);
  expect(result.packages).toEqual([]);
  const graph = result.graphs[0]!;
  const build = queryDependenciesV2(result, { graph: graph.id, root: "job:build" });
  expect(
    build.declarations
      .map((item) => item.dependency.requested.specifier)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(["actions/checkout@v4", "docker://alpine:3"]);
  expect(build.declarations.every((item) => item.applicability === "conditional")).toBe(true);
  expect(build.completeness).toBe("unknown");
  expect(
    graph.edges.find((edge) => edge.requested?.specifier === "actions/checkout@v4")?.condition
      ?.expression,
  ).toEqual({ job: "github.ref == 'refs/heads/main'", step: "success()" });
  expect(
    queryDependenciesV2(result, {
      graph: graph.id,
      root: "job:build",
      evaluateCondition: () => "false",
    }).declarations,
  ).toEqual([]);
});

test("unsupported job forms retain unknown coverage instead of successful empty dependency lists", () => {
  const result = extractWorkflowV2(
    "jobs:\n  reusable:\n    uses: org/repo/.github/workflows/ci.yml@main\n  broken:\n    steps:\n      - uses: 42\n",
  );
  expect(result.graphs[0]!.nodes.every((node) => node.dependencyCompleteness === "partial")).toBe(
    true,
  );
  expect(result.issues).toHaveLength(2);
  expect(() => extractWorkflowV2("invalid: [")).toThrow();
  expect(() => extractWorkflowV2("jobs: []")).toThrow("Expected workflow jobs object");
});

test("local and dynamic references are retained as requests without invented catalog entries", () => {
  const result = extractWorkflowV2(
    "jobs:\n  build:\n    steps:\n      - uses: ./local-action\n      - uses: '${{ matrix.action }}'\n",
  );
  expect(result.graphs[0]!.edges.map((edge) => edge.requested?.specifier)).toEqual([
    "./local-action",
    "${{ matrix.action }}",
  ]);
  expect(result.graphs[0]!.edges.every((edge) => edge.status === "declared")).toBe(true);
});
