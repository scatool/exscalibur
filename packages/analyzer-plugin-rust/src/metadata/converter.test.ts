import { readFile } from "node:fs/promises";
import { expect, test } from "vite-plus/test";
import { mergeResults, queryDependencies, validateResult } from "@scatool/analyzer-core";
import { convertCargoMetadata } from "./converter.ts";

type RecordValue = Record<string, unknown>;
const registry = "registry+https://github.com/rust-lang/crates.io-index";
const pkg = (id: string, name = id, more: RecordValue = {}) => ({
  id,
  name,
  version: "1.0.0",
  source: registry,
  manifest_path: `/source/${id}/Cargo.toml`,
  dependencies: [],
  targets: [{ name: name.replaceAll("-", "_"), kind: ["lib"] }],
  ...more,
});
const declaration = (name: string, more: RecordValue = {}) => ({
  name,
  req: "^1.0",
  kind: null,
  target: null,
  rename: null,
  optional: false,
  features: [],
  uses_default_features: true,
  source: registry,
  ...more,
});
const node = (id: string, deps: unknown[] = [], more: RecordValue = {}) => ({
  id,
  deps,
  features: [],
  ...more,
});
function convert(
  packages: RecordValue[],
  nodes: RecordValue[] | null,
  more: RecordValue = {},
  mapped = true,
) {
  const result = convertCargoMetadata(
    {
      version: 1,
      workspace_root: "/source",
      workspace_members: ["app"],
      packages,
      resolve: nodes === null ? null : { root: null, nodes },
      ...more,
    },
    {
      codebase: "example:cargo",
      evidenceFile: "cargo-metadata.json",
      ...(mapped && { definitionFilePrefix: "" }),
    },
  );
  validateResult(result);
  return result;
}
const app = (dependencies: unknown[] = []) => pkg("app", "app", { source: null, dependencies });

test("native kinds and predicates remain separate facts in an explicitly aggregate membership graph", () => {
  const result = convert(
    [
      app([
        declaration("shared"),
        declaration("shared", { kind: "build", target: "cfg(windows)" }),
      ]),
      pkg("shared"),
    ],
    [
      node("app", [
        {
          name: "shared",
          pkg: "shared",
          dep_kinds: [
            { kind: null, target: null },
            { kind: "build", target: "cfg(windows)" },
          ],
        },
      ]),
      node("shared", [], { features: ["build", "runtime"] }),
    ],
  );
  const graph = result.graphs.find((graph) => graph.interpretation === "resolved")!;
  expect(graph.roots.map((root) => root.scope)).toEqual(["cargo:metadata"]);
  expect(graph.edges.map((edge) => edge.kind)).toEqual(["build-dependencies", "dependencies"]);
  expect(
    graph.edges.every((edge) => edge.selection === "selected" && edge.condition === undefined),
  ).toBe(true);
  expect(
    graph.edges.find((edge) => edge.kind === "build-dependencies")!.requested!.condition,
  ).toEqual({
    language: "cargo:target-predicate/v1",
    expression: "cfg(windows)",
    environment: "cargo:declaring-compilation-unit",
  });
  expect(graph.nodes.find((node) => node.id === "shared")!.variant).toBeUndefined();
  expect(
    graph.nodes.find((node) => node.id === "shared")!.attributes![
      "cargo:packageResolutionFeatures"
    ],
  ).toEqual(["build", "runtime"]);
});

test("only workspace_members establishes projects, including with path dependencies", () => {
  const result = convert(
    [app(), pkg("external", "external", { source: null })],
    [
      node("app", [
        { name: "external", pkg: "external", dep_kinds: [{ kind: null, target: null }] },
      ]),
      node("external"),
    ],
  );
  expect(result.subprojects).toHaveLength(1);
  expect(result.subprojects[0]!.definitionFile).toBe("app/Cargo.toml");
  expect(result.packages.every((pkg) => pkg.purl.startsWith("pkg:generic/cargo-local/"))).toBe(
    true,
  );
});

test("same coordinates from alternate registry, Git revisions and local paths keep distinct identities", () => {
  const sources = [
    registry,
    "registry+https://example.com/index",
    "git+https://example.com/repo?branch=next%2Ftest#abc",
    "git+https://example.com/repo?branch=next%2Ftest#def",
    null,
  ];
  const result = convert(
    sources.map((source, i) => pkg(String(i), "same", { source })),
    [],
    { workspace_members: [] },
  );
  expect(new Set(result.packages.map((pkg) => pkg.purl)).size).toBe(5);
  expect(result.packages.some((pkg) => pkg.purl === "pkg:cargo/same@1.0.0")).toBe(true);
  expect(result.packages.filter((pkg) => pkg.purl.includes("cargo_source="))).toHaveLength(3);
});

test("inactive optional requests and defaults stay declarations without fabricated resolved targets", () => {
  const result = convert(
    [
      app([
        declaration("optional", {
          optional: true,
          features: ["serde"],
          uses_default_features: false,
          target: "cfg(unix)",
        }),
      ]),
    ],
    [node("app")],
  );
  expect(result.packages).toHaveLength(1);
  const graph = result.graphs.find((graph) => graph.interpretation === "declared")!;
  const edge = graph.edges.find(
    (edge) => edge.from === graph.roots.find((root) => root.scope === "dependencies")!.node,
  )!;
  expect(edge).toMatchObject({
    status: "declared",
    optional: true,
    selection: "conditional",
    requested: {
      name: "optional",
      specifier: "^1.0",
      features: ["serde"],
      attributes: { "cargo:declaration": { uses_default_features: false } },
    },
    condition: { expression: { target: "cfg(unix)", optionalDependency: "optional" } },
  });
});

test("no-deps metadata has unknown resolved coverage and independent declared roots", () => {
  const result = convert([app([declaration("child")]), pkg("child")], null);
  const graph = result.graphs.find((graph) => graph.interpretation === "unknown")!;
  const closure = queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id });
  expect(closure.completeness).toBe("unknown");
  expect(closure.definite).toEqual([]);
  expect(result.graphs.find((graph) => graph.interpretation === "declared")!.roots).toHaveLength(3);
});

test.each([{ value: undefined }, { value: [] }, { value: [{}] }])(
  "unreported kinds (%j) cannot borrow normal declaration requests or optionality",
  ({ value: depKinds }) => {
    const dep = {
      name: "child",
      pkg: "child",
      ...(depKinds !== undefined && { dep_kinds: depKinds }),
    };
    const result = convert(
      [app([declaration("child", { optional: true, features: ["foo"] })]), pkg("child")],
      [node("app", [dep]), node("child")],
    );
    const edge = result.graphs.find((graph) => graph.interpretation === "resolved")!.edges[0]!;
    expect(edge.kind).toBe("cargo:unreported-kind");
    expect(edge.optional).toBeUndefined();
    expect(edge.requested!.specifier).toBeUndefined();
    expect(edge.requested!.features).toBeUndefined();
  },
);

test("custom library names and renamed extern names match declarations without requiring identical sources", () => {
  const result = convert(
    [
      app([
        declaration("actual", { rename: "my-alias", features: ["named"] }),
        declaration("custom"),
      ]),
      pkg("actual", "actual", { source: "git+https://example.com/patched#abc" }),
      pkg("custom", "custom", { targets: [{ name: "other_lib", kind: ["lib"] }] }),
    ],
    [
      node("app", [
        { name: "my_alias", pkg: "actual", dep_kinds: [{ kind: null, target: null }] },
        { name: "other_lib", pkg: "custom", dep_kinds: [{ kind: null, target: null }] },
      ]),
      node("actual"),
      node("custom"),
    ],
  );
  const graph = result.graphs.find((graph) => graph.interpretation === "resolved")!;
  expect(graph.edges.find((edge) => edge.to === "actual")!.requested).toMatchObject({
    name: "my-alias",
    features: ["named"],
  });
  expect(graph.edges.find((edge) => edge.to === "custom")!.requested).toMatchObject({
    name: "custom",
    specifier: "^1.0",
  });
});

test("ambiguous alias matches preserve candidates without borrowing the first request", () => {
  const result = convert(
    [
      app([
        declaration("child", { rename: "my-alias" }),
        declaration("child", { rename: "my_alias", features: ["wrong"] }),
      ]),
      pkg("child"),
    ],
    [
      node("app", [{ name: "my_alias", pkg: "child", dep_kinds: [{ kind: null, target: null }] }]),
      node("child"),
    ],
  );
  const edge = result.graphs.find((graph) => graph.interpretation === "resolved")!.edges[0]!;
  expect(edge.requested!.specifier).toBeUndefined();
  expect(edge.optional).toBeUndefined();
  expect(edge.attributes!["cargo:matchingDeclarations"]).toHaveLength(2);
});

test("opaque missing IDs retain a PURL and unknown adjacency instead of parsing the ID", () => {
  const result = convert(
    [app()],
    [
      node("app", [
        {
          name: "external",
          pkg: "opaque ID with no crate coordinates",
          dep_kinds: [{ kind: null, target: null }],
        },
      ]),
    ],
  );
  const graph = result.graphs.find((graph) => graph.interpretation === "resolved")!;
  const missing = graph.nodes.find((node) => node.id === "opaque ID with no crate coordinates")!;
  expect(missing.purl).toMatch(/^pkg:generic\/cargo-unknown\//);
  expect(missing.dependencyCompleteness).toBe("unknown");
  expect(
    queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
  ).toBe("unknown");
});

test("legacy package-ID edges retain membership without invented request or kind", () => {
  const result = convert(
    [app(), pkg("child")],
    [{ id: "app", dependencies: ["child"], features: [] }, node("child")],
  );
  const edge = result.graphs.find((graph) => graph.interpretation === "resolved")!.edges[0]!;
  expect(edge.to).toBe("child");
  expect(edge.kind).toBeUndefined();
  expect(edge.requested).toBeUndefined();
});

test("unmapped exports from different workspaces retain distinct local projects", () => {
  const build = (directory: string) =>
    convert(
      [pkg("app", "app", { source: null, manifest_path: `${directory}/Cargo.toml` })],
      [node("app")],
      { workspace_root: directory },
      false,
    );
  const a = build("/workspace/a"),
    b = build("/workspace/b");
  expect(a.subprojects[0]!.purl).not.toBe(b.subprojects[0]!.purl);
  expect(mergeResults([a, b]).subprojects).toHaveLength(2);
  expect(a.subprojects[0]!.definitionFile).toMatch(/^cargo-metadata\.json#cargo-project=/);
});

test("missing member declaration arrays retain unknown roots", () => {
  const missing = app();
  delete (missing as RecordValue).dependencies;
  const result = convert([missing], [node("app")]);
  const graph = result.graphs.find((graph) => graph.interpretation === "declared")!;
  expect(graph.rootCompleteness).toBe("partial");
  expect(graph.nodes.find((node) => node.id === graph.roots[0]!.node)!.dependencyCompleteness).toBe(
    "unknown",
  );
});

test.each(["cargo-metadata.json.txt", "cargo-metadata-linux.json.txt"])(
  "native capture %s preserves opaque nodes and dependency-kind tuples",
  async (file) => {
    // Regression evidence captured from checksum-verified Cargo 1.90.0, not an expected SBOM.
    const input = JSON.parse(
      await readFile(new URL(`./__fixtures__/cargo-1.90.0/${file}`, import.meta.url), "utf8"),
    );
    const result = convertCargoMetadata(input, {
      codebase: "example:native-cargo",
      evidenceFile: "cargo-metadata.json",
      definitionFilePrefix: "",
    });
    validateResult(result);
    const graph = result.graphs.find((graph) => graph.interpretation === "resolved")!;
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      input.resolve.nodes.map((node: RecordValue) => node.id).sort(),
    );
    expect(graph.edges).toHaveLength(
      input.resolve.nodes.reduce(
        (count: number, node: { deps: { dep_kinds: unknown[] }[] }) =>
          count + node.deps.reduce((n, dep) => n + dep.dep_kinds.length, 0),
        0,
      ),
    );
    expect(result.subprojects).toHaveLength(input.workspace_members.length);
  },
);

test("opaque package IDs cannot collide with synthetic declaration scope IDs", () => {
  const opaque = 'scope:["app","dependencies"]';
  const result = convert(
    [app([declaration("child")]), pkg(opaque, "child")],
    [node("app"), node(opaque)],
  );
  const graph = result.graphs.find((graph) => graph.interpretation === "declared")!;
  const root = graph.roots.find((root) => root.scope === "dependencies")!;
  expect(graph.nodes.find((node) => node.id === root.node)!.project).toEqual(root.project);
  expect(graph.nodes.find((node) => node.locator === opaque)!.id).not.toBe(root.node);
});

test("unknown format versions and conflicting package IDs are explicit failures", () => {
  expect(() => convert([], [], { version: 2 })).toThrow("Unsupported Cargo metadata format");
  expect(() => convert([app(), app()], [])).toThrow("Duplicate Cargo package ID");
});
