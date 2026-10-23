import { expect, test } from "vite-plus/test";
import {
  createDependencyGraph,
  createEmptyResultV2,
  mergeResultsV2,
  normalizeResultV2,
  parseResultV2,
  queryDependenciesV2,
  validateResultV2,
} from "./index.ts";
import type {
  AnalyzerResultV2,
  ConditionEvaluator,
  DependencyCondition,
  DependencyEdge,
  DependencyView,
  JsonObject,
  ProjectReference,
  ResolvedDependency,
} from "./types.ts";

const appPurl = "pkg:generic/workspace/app";
const a: ProjectReference = { purl: appPurl, definitionFile: "apps/a/package.json" };
const b: ProjectReference = { purl: appPurl, definitionFile: "apps/b/package.json" };
const foo = "pkg:npm/foo@1.0.0";
const bridge = "pkg:npm/bridge@1.0.0";
const react18 = "pkg:npm/react@18.3.1";
const react19 = "pkg:npm/react@19.0.0";
const view = (id: string, purl: string, project?: ProjectReference): DependencyView => ({
  id,
  purl,
  ...(project && { project }),
  dependencyCompleteness: "complete",
});
const edge = (from: string, to: string): ResolvedDependency => ({
  from,
  to,
  status: "resolved",
  relation: "depends-on",
  selection: "selected",
});

function fixture(key = "default"): AnalyzerResultV2 {
  const graph = createDependencyGraph({
    source: { extractor: "contract", files: ["package-lock.json"], key },
    interpretation: "resolved",
    rootCompleteness: "complete",
    roots: [
      { id: "a/dependencies", project: a, scope: "dependencies", node: "a" },
      { id: "b/dependencies", project: b, scope: "dependencies", node: "b" },
    ],
    nodes: [
      view("a", appPurl, a),
      view("b", appPurl, b),
      view("foo-a", foo),
      view("foo-b", foo),
      view("react18", react18),
      view("react19", react19),
    ],
    edges: [
      edge("a", "foo-a"),
      edge("b", "foo-b"),
      edge("foo-a", "react18"),
      edge("foo-b", "react19"),
    ],
  });
  return {
    ...createEmptyResultV2("example:workspace"),
    packages: [foo, react18, react19].map((purl) => ({ purl, evidence: ["package-lock.json"] })),
    subprojects: [a, b],
    graphs: [graph],
  };
}

function closure(
  result: AnalyzerResultV2,
  root = "a/dependencies",
  evaluateCondition?: ConditionEvaluator,
  context?: JsonObject,
) {
  return queryDependenciesV2(result, {
    graph: result.graphs[0]!.id,
    root,
    evaluateCondition,
    context,
  });
}

function replaceEdges(result: AnalyzerResultV2, edges: DependencyEdge[]): void {
  result.graphs[0]!.edges = edges;
}

test("equal PURLs and equal scope names retain exact source-project ownership and peer contexts", () => {
  const result = fixture();
  validateResultV2(result);
  expect(closure(result).definite).toEqual(["foo-a", "react18"]);
  expect(closure(result, "b/dependencies").definite).toEqual(["foo-b", "react19"]);
  expect(result.subprojects.map((project) => project.purl)).toEqual([appPurl, appPurl]);
  expect(closure(result).completeness).toBe("complete");
});

test("one project/scope can contain two views of the same package", () => {
  const result = fixture();
  result.graphs[0]!.edges.push(edge("a", "foo-b"));
  expect(closure(result).definite).toEqual(["foo-a", "foo-b", "react18", "react19"]);
  expect(closure(result, "b/dependencies").definite).toEqual(["foo-b", "react19"]);
});

test("empty native root locators are retained as observed rather than rejected as missing IDs", () => {
  const result = fixture();
  result.graphs[0]!.nodes[0]!.locator = "";
  expect(parseResultV2(result).graphs[0]!.nodes[0]!.locator).toBe("");
});

test("equal producer variants and immediate target PURLs do not merge different transitive views", () => {
  const result = fixture();
  const graph = result.graphs[0]!;
  result.packages.push({ purl: bridge, evidence: [] });
  graph.nodes.push(view("bridge-a", bridge), view("bridge-b", bridge));
  for (const node of graph.nodes.filter((node) => node.purl === foo)) {
    node.variant = { name: "same-artifact", enabledFeatures: [] };
  }
  replaceEdges(result, [
    edge("a", "foo-a"),
    edge("b", "foo-b"),
    edge("foo-a", "bridge-a"),
    edge("foo-b", "bridge-b"),
    edge("bridge-a", "react18"),
    edge("bridge-b", "react19"),
  ]);
  const normalized = normalizeResultV2(result);
  expect(closure(normalized).definite).toEqual(["bridge-a", "foo-a", "react18"]);
  expect(closure(normalized, "b/dependencies").definite).toEqual(["bridge-b", "foo-b", "react19"]);
  expect(normalized.graphs[0]!.nodes.filter((node) => node.purl === foo)).toHaveLength(2);
});

test("consuming a workspace project does not traverse that project's development roots", () => {
  const result = fixture();
  const graph = result.graphs[0]!;
  graph.nodes.push(view("b-consumed", appPurl, b));
  graph.roots[1]!.scope = "devDependencies";
  replaceEdges(result, [
    edge("a", "b-consumed"),
    edge("b-consumed", "react18"),
    edge("b", "react19"),
  ]);
  expect(closure(result).definite).toEqual(["b-consumed", "react18"]);
  expect(closure(result, "b/dependencies").definite).toEqual(["react19"]);
});

test("a path-specific exclusion changes adjacency without changing the selected artifact", () => {
  const result = fixture();
  const graph = result.graphs[0]!;
  for (const node of graph.nodes.filter((node) => node.purl === foo)) {
    node.variant = { name: "identical-jar" };
  }
  replaceEdges(result, [edge("a", "foo-a"), edge("b", "foo-b"), edge("foo-b", "react19")]);
  expect(closure(result).definite).toEqual(["foo-a"]);
  expect(closure(result, "b/dependencies").definite).toEqual(["foo-b", "react19"]);
  graph.edges.push(edge("a", "react19"));
  expect(closure(result).definite).toEqual(["foo-a", "react19"]);
});

test("selected optional dependencies are followed and constraints introduce no reachability", () => {
  const result = fixture();
  result.graphs[0]!.edges[0] = { ...edge("a", "foo-a"), kind: "peerDependencies", optional: true };
  result.graphs[0]!.edges.push({ ...edge("a", "react19"), relation: "constrains" });
  const normalized = normalizeResultV2(result);
  expect(closure(normalized).definite).toEqual(["foo-a", "react18"]);
  expect(normalized.graphs[0]!.edges).toContainEqual({
    ...edge("a", "foo-a"),
    kind: "peerDependencies",
    optional: true,
  });
});

test("declaration-only input preserves the original request without inventing a target or resolved version", () => {
  const result = fixture();
  result.graphs[0]!.interpretation = "declared";
  replaceEdges(result, [
    {
      from: "a",
      relation: "depends-on",
      selection: "selected",
      status: "declared",
      requested: { name: "foo", specifier: "^2.0.0", purl: "pkg:npm/foo", features: ["extra"] },
    },
  ]);
  const reached = closure(result);
  expect(reached.definite).toEqual([]);
  expect(reached.interpretation).toBe("declared");
  expect(reached.completeness).toBe("unknown");
  expect(reached.declarations).toEqual([
    {
      dependency: result.graphs[0]!.edges[0],
      applicability: "definite",
      conditions: [],
    },
  ]);
  expect(result.graphs[0]!.nodes.every((node) => !node.purl.includes("@2"))).toBe(true);
});

test("an attempted but unresolved target makes the established closure partial", () => {
  const result = fixture();
  result.graphs[0]!.edges.push({
    from: "foo-a",
    relation: "depends-on",
    status: "unresolved",
    selection: "selected",
    requested: { name: "missing", specifier: "https://example.com/missing.tgz" },
  });
  expect(closure(result).completeness).toBe("partial");
  expect(closure(result).declarations[0]!.dependency.requested.specifier).toBe(
    "https://example.com/missing.tgz",
  );
});

test("explicit empty adjacency and unexamined adjacency remain distinguishable", () => {
  const result = fixture();
  replaceEdges(result, [edge("a", "foo-a")]);
  expect(closure(result).completeness).toBe("complete");
  result.graphs[0]!.nodes.find((node) => node.id === "foo-a")!.dependencyCompleteness = "unknown";
  expect(closure(normalizeResultV2(result)).completeness).toBe("unknown");
});

test("unknown candidate selection is never silently promoted to definite", () => {
  const result = fixture();
  result.graphs[0]!.edges[0] = { ...edge("a", "foo-a"), selection: "unknown" };
  const reached = closure(result);
  expect(reached.definite).toEqual([]);
  expect(reached.conditional).toEqual(["foo-a", "react18"]);
  expect(reached.completeness).toBe("partial");
});

test("an independently definite path establishes membership despite an uncertain duplicate path", () => {
  const result = fixture();
  result.graphs[0]!.edges.push({ ...edge("a", "foo-a"), selection: "unknown" });
  expect(closure(result).definite).toEqual(["foo-a", "react18"]);
  expect(closure(result).conditional).toEqual([]);
  expect(closure(result).completeness).toBe("complete");
});

const os = (equals: string, environment?: string): DependencyCondition => ({
  language: "contract:platform",
  expression: { variable: "os", equals },
  ...(environment && { environment }),
});
const extra = (equals: string): DependencyCondition => ({
  language: "contract:extra",
  expression: { variable: "extra", equals },
});
const conditionalEdge = (
  from: string,
  to: string,
  condition: DependencyCondition,
): ResolvedDependency => ({
  from,
  to,
  status: "resolved",
  relation: "depends-on",
  selection: "conditional",
  condition,
});

// Test evaluator only: checks one consistent platform per domain and local features per owner.
const evaluate: ConditionEvaluator = ({ conditions, context, graph }) => {
  let unknown = false;
  const domains = new Map<string, string>();
  for (const { condition, owner } of conditions) {
    const expression = condition.expression as { equals: string };
    if (condition.language === "contract:platform") {
      const domain = condition.environment ?? "default";
      const previous = domains.get(domain);
      if (previous !== undefined && previous !== expression.equals) return "false";
      domains.set(domain, expression.equals);
      const selected = (context[domain] as JsonObject | undefined)?.os;
      if (selected !== undefined && selected !== expression.equals) return "false";
      if (selected === undefined) unknown = true;
    } else if (condition.language === "contract:extra") {
      const enabled = graph.nodes.find((node) => node.id === owner)?.variant?.enabledFeatures;
      if (enabled !== undefined && !enabled.includes(expression.equals)) return "false";
      if (enabled === undefined) unknown = true;
    } else {
      unknown = true;
    }
  }
  return unknown ? "unknown" : "true";
};

test("conditions are conjoined along a path rather than independently treated as possible", () => {
  const result = fixture();
  replaceEdges(result, [
    conditionalEdge("a", "foo-a", os("linux")),
    conditionalEdge("foo-a", "react18", os("windows")),
  ]);
  expect(closure(result).definite).toEqual([]);
  expect(closure(result).conditional).toEqual(["foo-a", "react18"]);
  const unknownPlatform = closure(result, "a/dependencies", evaluate);
  expect(unknownPlatform.definite).toEqual([]);
  expect(unknownPlatform.conditional).toEqual(["foo-a"]);
  const linux = closure(result, "a/dependencies", evaluate, { default: { os: "linux" } });
  expect(linux.definite).toEqual(["foo-a"]);
  expect(linux.conditional).toEqual([]);
  expect(linux.completeness).toBe("complete");
});

test("local extras are evaluated for their declaring views, not as one global variable", () => {
  const result = fixture();
  const graph = result.graphs[0]!;
  graph.nodes.find((node) => node.id === "a")!.variant = { enabledFeatures: ["feature-a"] };
  graph.nodes.find((node) => node.id === "foo-a")!.variant = { enabledFeatures: ["feature-b"] };
  replaceEdges(result, [
    conditionalEdge("a", "foo-a", extra("feature-a")),
    conditionalEdge("foo-a", "react18", extra("feature-b")),
  ]);
  expect(closure(result, "a/dependencies", evaluate).definite).toEqual(["foo-a", "react18"]);
});

test("build and target environments may differ within the same dependency path", () => {
  const result = fixture();
  replaceEdges(result, [
    conditionalEdge("a", "foo-a", os("linux", "build")),
    conditionalEdge("foo-a", "react18", os("windows", "target")),
  ]);
  expect(
    closure(result, "a/dependencies", evaluate, {
      build: { os: "linux" },
      target: { os: "windows" },
    }).definite,
  ).toEqual(["foo-a", "react18"]);
});

test("conditional declaration results retain their applicability, owner, and ancestor predicates", () => {
  const result = fixture();
  replaceEdges(result, [
    conditionalEdge("a", "foo-a", os("linux")),
    {
      from: "foo-a",
      status: "declared",
      relation: "depends-on",
      selection: "selected",
      requested: { name: "missing", specifier: "^1" },
    },
  ]);
  const declaration = closure(result).declarations[0]!;
  expect(declaration.applicability).toBe("conditional");
  expect(declaration.conditions).toEqual([{ owner: "a", condition: os("linux") }]);
});

test("cycles terminate without changing native view identity or discarding conditional paths", () => {
  const result = fixture();
  replaceEdges(result, [
    edge("a", "foo-a"),
    conditionalEdge("foo-a", "react18", os("linux")),
    edge("react18", "foo-a"),
  ]);
  expect(closure(result).definite).toEqual(["foo-a"]);
  expect(closure(result).conditional).toEqual(["react18"]);
  expect(
    closure(result, "a/dependencies", evaluate, { default: { os: "linux" } }).definite,
  ).toEqual(["foo-a", "react18"]);
});

test("recorded selection retains its original request predicate without reinterpreting the graph", () => {
  const result = fixture();
  result.graphs[0]!.edges[0] = {
    ...edge("a", "foo-a"),
    requested: { name: "foo", condition: os("linux") },
  };
  expect(
    closure(result, "a/dependencies", evaluate, { default: { os: "windows" } }).definite,
  ).toEqual(["foo-a", "react18"]);
});

test("merge retains independent observation namespaces despite identical native node IDs", () => {
  const first = fixture("resolver-a");
  const second = fixture("resolver-b");
  replaceEdges(second, [edge("a", "foo-b"), edge("foo-b", "react19")]);
  const merged = mergeResultsV2([first, second]);
  expect(merged.graphs).toHaveLength(2);
  expect(
    queryDependenciesV2(merged, { graph: first.graphs[0]!.id, root: "a/dependencies" }).definite,
  ).toEqual(["foo-a", "react18"]);
  expect(
    queryDependenciesV2(merged, { graph: second.graphs[0]!.id, root: "a/dependencies" }).definite,
  ).toEqual(["foo-b", "react19"]);
});

test("merge is commutative, associative, idempotent, and does not mutate inputs", () => {
  const first = fixture("one");
  const second = fixture("two");
  const third = fixture("three");
  first.packages[0]!.evidence = ["z", "a"];
  second.packages[0]!.evidence = ["b", "a"];
  third.packages[0]!.artifacts = [{ location: "https://example.com/foo.tgz", evidence: ["lock"] }];
  const original = structuredClone(first);
  expect(mergeResultsV2([first, second])).toEqual(mergeResultsV2([second, first]));
  expect(mergeResultsV2([mergeResultsV2([first, second]), third])).toEqual(
    mergeResultsV2([first, mergeResultsV2([second, third])]),
  );
  expect(mergeResultsV2([first, first])).toEqual(normalizeResultV2(first));
  expect(first).toEqual(original);
});

test("conflicting observation IDs and codebase namespaces are explicit errors", () => {
  const first = fixture();
  const second = fixture();
  replaceEdges(second, [edge("a", "react19")]);
  expect(() => mergeResultsV2([first, second])).toThrow(
    "Conflicting dependency graph observation ID",
  );
  second.codebase = "other:repository";
  expect(() => mergeResultsV2([first, second])).toThrow("without explicit reconciliation");
  expect(() => mergeResultsV2([])).toThrow("explicit codebase namespace");
  expect(mergeResultsV2([], { codebase: first.codebase })).toEqual(
    createEmptyResultV2(first.codebase),
  );
});

test("artifact observations are retained and metadata conflicts never become first-wins", () => {
  const first = fixture("one");
  const second = fixture("two");
  first.packages[0]!.artifacts = [
    { location: "https://a.example/foo.tgz", hashes: { sha256: "a" }, evidence: ["one"] },
  ];
  second.packages[0]!.artifacts = [
    { location: "https://b.example/foo.tgz", hashes: { sha256: "b" }, evidence: ["two"] },
  ];
  expect(
    mergeResultsV2([first, second]).packages.find((pkg) => pkg.purl === foo)!.artifacts,
  ).toHaveLength(2);
  first.packages[0]!.attributes = { "example:identity": "one" };
  second.packages[0]!.attributes = { "example:identity": "two" };
  expect(() => mergeResultsV2([first, second])).toThrow("Conflicting observations");
});

test("normalization preserves additive fields, native array order, false values, and unknown feature sets", () => {
  const input = fixture();
  const extended = { ...input, extension: { order: [2, 1], enabled: false } };
  extended.graphs[0]!.attributes = { "example:opaque": ["second", "first"] };
  extended.graphs[0]!.nodes[0]!.variant = { attributes: { "example:flag": false } };
  const original = structuredClone(extended);
  const normalized = normalizeResultV2(extended);
  expect(JSON.parse(JSON.stringify(normalized)).extension).toEqual(extended.extension);
  expect(normalized.graphs[0]!.attributes).toEqual(extended.graphs[0]!.attributes);
  expect(normalized.graphs[0]!.nodes.find((node) => node.id === "a")!.variant).toEqual({
    attributes: { "example:flag": false },
  });
  expect(normalizeResultV2(normalized)).toEqual(normalized);
  expect(extended).toEqual(original);
});

test("arbitrary JSON extension keys survive validation, compatible merge, and normalization", () => {
  const first = fixture("one");
  const second = fixture("two");
  first.packages[0]!.attributes = { ordinary: true };
  second.packages[0]!.attributes = JSON.parse(
    '{"constructor":"native","toString":false,"__proto__":{"observed":true}}',
  );
  const extended = {
    ...first,
    ...JSON.parse('{"constructor":"native","__proto__":{"observed":true}}'),
  };
  const merged = mergeResultsV2([extended, second]);
  const serialized = JSON.parse(JSON.stringify(merged));
  expect(serialized.constructor).toBe("native");
  expect(Object.hasOwn(serialized, "__proto__")).toBe(true);
  expect(serialized.__proto__).toEqual({ observed: true });
  const attributes = merged.packages.find((pkg) => pkg.purl === foo)!.attributes!;
  expect(attributes.constructor).toBe("native");
  expect(Object.entries(attributes)).toContainEqual(["toString", false]);
  expect(Object.hasOwn(attributes, "__proto__")).toBe(true);
  expect(attributes.__proto__).toEqual({ observed: true });
  expect(({} as Record<string, unknown>).observed).toBeUndefined();
});

test("native metadata rejects non-JSON objects and cycles rather than silently serializing them away", () => {
  for (const unsupported of [
    new Date(),
    new Map(),
    new Set(),
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const result = fixture();
    expect(() => parseResultV2({ ...result, attributes: { unsupported } })).toThrow();
  }
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => parseResultV2({ ...fixture(), extension: cycle })).toThrow();
  const hidden = { ...fixture(), ...JSON.parse('{"__proto__":null}') };
  Object.defineProperty(hidden, "__proto__", { value: new Date(), enumerable: true });
  expect(() => parseResultV2(hidden)).toThrow("plain JSON data");
});

test("observation IDs are deterministic under set ordering, sensitive to context, and safe for cycles", () => {
  const graph = fixture().graphs[0]!;
  const { id: _, ...input } = graph;
  const reversed = {
    ...input,
    nodes: [...input.nodes].reverse(),
    edges: [...input.edges].reverse(),
    roots: [...input.roots].reverse(),
  };
  expect(createDependencyGraph(input).id).toBe(createDependencyGraph(reversed).id);
  expect(createDependencyGraph({ ...input, context: { "example:target": "other" } }).id).not.toBe(
    graph.id,
  );
  expect(
    createDependencyGraph({
      ...input,
      edges: [...input.edges, edge("react18", "foo-a")],
    }).nodes.map((node) => node.id),
  ).toEqual(graph.nodes.map((node) => node.id));
});

test("runtime validation requires valid mandatory PURLs and exact project and graph-local references", () => {
  const result = fixture();
  const missingPurl = JSON.parse(JSON.stringify(result));
  delete missingPurl.packages[0].purl;
  expect(() => parseResultV2(missingPurl)).toThrow();
  expect(() =>
    parseResultV2({ ...result, packages: [{ purl: "not-a-purl", evidence: [] }] }),
  ).toThrow();
  const invalidProject = fixture();
  invalidProject.graphs[0]!.nodes.find((node) => node.id === "a")!.project = b;
  expect(() => validateResultV2(invalidProject)).toThrow("exact project/subject's view");
  const dangling = fixture();
  dangling.graphs[0]!.edges.push(edge("a", "foreign-node"));
  expect(() => validateResultV2(dangling)).toThrow("unknown target view");
  const unlisted = fixture();
  unlisted.graphs[0]!.nodes.push(view("unknown", "pkg:npm/unlisted@1"));
  expect(() => validateResultV2(unlisted)).toThrow("unknown package");
});

test("illegal selection/declaration states are rejected instead of interpreted heuristically", () => {
  const result = fixture();
  const invalidEdges = [
    { ...edge("a", "foo-a"), selection: "conditional" },
    { ...edge("a", "foo-a"), condition: os("linux") },
    { from: "a", status: "declared", relation: "depends-on", selection: "selected", requested: {} },
    {
      from: "a",
      to: "foo-a",
      status: "declared",
      relation: "depends-on",
      selection: "selected",
      requested: { name: "foo" },
    },
  ];
  for (const invalidEdge of invalidEdges) {
    expect(() =>
      parseResultV2({ ...result, graphs: [{ ...result.graphs[0], edges: [invalidEdge] }] }),
    ).toThrow();
  }
});
