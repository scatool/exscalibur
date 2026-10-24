import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  queryDependenciesV2,
  validateResultV2,
  type AnalyzerResultV2,
} from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";
type RecordValue = Record<string, unknown>;
async function extract(lock: unknown, files: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "exscalibur-malformed-lock-"));
  try {
    for (const [path, value] of Object.entries({ "package-lock.json": lock, ...files })) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(
        join(directory, path),
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    const result = await extractorV2.extract(directory, undefined, {
      codebaseId: "test:malformed-lock",
    });
    validateResultV2(result);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function failed(result: AnalyzerResultV2) {
  expect(result.issues.filter((i) => i.severity === "ERROR").map((i) => [i.code, i.file])).toEqual([
    ["core.file_extraction_failed", "package-lock.json"],
  ]);
  expect(result.packages).toEqual([]);
  expect(result.subprojects).toEqual([]);
  expect(result.graphs).toHaveLength(1);
  expect(result.graphs[0]).toMatchObject({
    interpretation: "unknown",
    rootCompleteness: "unknown",
    nodes: [],
    edges: [],
    roots: [],
  });
}
const root = { name: "app", version: "1.0.0" };
const malformed: [string, unknown][] = [
  ["truncated JSON", '{"lockfileVersion":3,"packages":'],
  ["null document", "null"],
  ["array document", []],
  ["null packages table", { lockfileVersion: 3, packages: null }],
  ["array packages table", { lockfileVersion: 3, packages: [] }],
  ["null package record", { lockfileVersion: 3, packages: { "": root, "node_modules/dep": null } }],
  [
    "null root dependency table",
    { lockfileVersion: 3, packages: { "": { ...root, dependencies: null } } },
  ],
  [
    "null package dependency table",
    {
      lockfileVersion: 3,
      packages: { "": root, "node_modules/dep": { version: "1.0.0", dependencies: null } },
    },
  ],
  [
    "non-string dependency request",
    { lockfileVersion: 3, packages: { "": { ...root, dependencies: { dep: 42 } } } },
  ],
  ["null v1 dependencies table", { lockfileVersion: 1, dependencies: null }],
  [
    "null v1 requires table",
    { lockfileVersion: 1, dependencies: { dep: { version: "1.0.0", requires: null } } },
  ],
];
for (const [name, lock] of malformed)
  test(`${name} preserves native absence or explicit failure`, async () => {
    const result = await extract(lock);
    if (
      [
        "null root dependency table",
        "null package dependency table",
        "null v1 dependencies table",
        "null v1 requires table",
      ].includes(name)
    ) {
      // npm treats explicit null declaration tables as absent; do not invent invalid-input errors.
      expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
      expect(result.graphs.every((graph) => graph.interpretation === "locked")).toBe(true);
      expect(result.graphs.every((graph) => graph.edges.length === 0)).toBe(true);
    } else failed(result);
  });
test("referenced cyclic links fail with an unknown observation", async () => {
  failed(
    await extract({
      lockfileVersion: 3,
      packages: {
        "": { ...root, dependencies: { loop: "*" } },
        "node_modules/loop": { link: true, resolved: "node_modules/other" },
        "node_modules/other": { link: true, resolved: "node_modules/loop" },
      },
    }),
  );
});
for (const link of [{ link: true, resolved: "missing/source" }])
  test(`dangling link ${JSON.stringify(link)} preserves unresolved request`, async () => {
    const result = await extract({
      lockfileVersion: 3,
      packages: { "": { ...root, dependencies: { dep: "*" } }, "node_modules/dep": link },
    });
    const graph = result.graphs[0]!;
    expect(graph.rootCompleteness).toBe("unknown");
    expect(result.issues.some((issue) => issue.code === "npm.link_target_missing")).toBe(true);
    const scope = graph.roots.find((r) => r.scope === "dependencies")!;
    const edge = graph.edges.find((e) => e.from === scope.node)!;
    expect(edge.status).toBe("unresolved");
    expect(edge.to).toBeUndefined();
    expect(edge.requested).toMatchObject({ name: "dep", specifier: "*" });
    expect(result.issues.some((i) => i.code === "npm.unresolved_dependency")).toBe(true);
    expect(queryDependenciesV2(result, { graph: graph.id, root: scope.id }).completeness).toBe(
      "partial",
    );
  });
test("nearest dangling link shadows an available ancestor package", async () => {
  const result = await extract({
    lockfileVersion: 3,
    packages: {
      "": { ...root, dependencies: { parent: "1" } },
      "node_modules/parent": { version: "1.0.0", dependencies: { dep: "1" } },
      "node_modules/parent/node_modules/dep": { link: true, resolved: "missing/source" },
      "node_modules/dep": { version: "1.0.0" },
    },
  });
  const graph = result.graphs[0]!;
  expect(graph.rootCompleteness).toBe("unknown");
  const parent = graph.nodes.find((n) => n.locator === "node_modules/parent")!;
  expect(graph.edges.find((e) => e.from === parent.id)).toMatchObject({
    status: "unresolved",
    requested: { name: "dep", specifier: "1" },
  });
  expect(graph.edges.find((e) => e.from === parent.id)?.to).toBeUndefined();
  const scope = graph.roots.find((r) => r.scope === "dependencies")!;
  const query = queryDependenciesV2(result, { graph: graph.id, root: scope.id });
  expect(query.completeness).toBe("partial");
  expect(query.definite.map((id) => graph.nodes.find((n) => n.id === id)!.purl)).not.toContain(
    "pkg:npm/dep@1.0.0",
  );
});
test("linked local package resolves nested dependencies from its source target", async () => {
  const source = { name: "linked", version: "1.0.0", dependencies: { dep: "*" } };
  const packages: RecordValue = {
    "": { ...root, dependencies: { linked: "file:packages/linked" } },
    "node_modules/linked": { link: true, resolved: "packages/linked" },
    "packages/linked": source,
    "packages/linked/node_modules/dep": { version: "1.0.0" },
    "node_modules/linked/node_modules/dep": { version: "2.0.0" },
    "node_modules/dep": { version: "3.0.0" },
  };
  const result = await extract(
    { lockfileVersion: 3, packages },
    { "packages/linked/package.json": source },
  );
  expect(result.issues).toEqual([]);
  const graph = result.graphs[0]!;
  const consumer = graph.nodes.find((n) => n.locator === "packages/linked")!;
  const edge = graph.edges.find((e) => e.from === consumer.id)!;
  expect(edge.status).toBe("resolved");
  expect(edge.selection).toBe("selected");
  expect(graph.nodes.find((n) => n.id === edge.to)?.locator).toBe(
    "packages/linked/node_modules/dep",
  );
  const scope = graph.roots.find(
    (r) => r.scope === "dependencies" && r.project.definitionFile === "package-lock.json#packages/",
  )!;
  const query = queryDependenciesV2(result, { graph: graph.id, root: scope.id });
  expect(query.definite.map((id) => graph.nodes.find((n) => n.id === id)!.purl)).toContain(
    "pkg:npm/dep@1.0.0",
  );
  expect(query.definite.map((id) => graph.nodes.find((n) => n.id === id)!.purl)).not.toContain(
    "pkg:npm/dep@2.0.0",
  );
  expect(query.definite.map((id) => graph.nodes.find((n) => n.id === id)!.purl)).not.toContain(
    "pkg:npm/dep@3.0.0",
  );
});

for (const [name, record] of [
  ["missing resolved", { link: true }],
  ["nonboolean link", { link: "true", resolved: "packages/dep" }],
] as const)
  test(`orphan ${name} fails closed`, async () => {
    failed(
      await extract({ lockfileVersion: 3, packages: { "": root, "node_modules/orphan": record } }),
    );
  });
test("orphan cyclic links fail independently of root reachability", async () => {
  failed(
    await extract({
      lockfileVersion: 3,
      packages: {
        "": root,
        "node_modules/a": { link: true, resolved: "node_modules/b" },
        "node_modules/b": { link: true, resolved: "node_modules/a" },
      },
    }),
  );
});
test("orphan dangling link retains known packages with unknown root coverage", async () => {
  const result = await extract({
    lockfileVersion: 3,
    packages: {
      "": root,
      "node_modules/orphan": { link: true, resolved: "missing/source" },
      "node_modules/known": { version: "1.0.0" },
    },
  });
  expect(result.issues.map((issue) => [issue.code, issue.severity])).toEqual([
    ["npm.link_target_missing", "WARNING"],
  ]);
  expect(result.graphs[0]).toMatchObject({ interpretation: "locked", rootCompleteness: "unknown" });
  expect(result.packages.map((pkg) => pkg.purl)).toEqual(["pkg:npm/known@1.0.0"]);
});
test("referenced link without a destination fails closed", async () => {
  failed(
    await extract({
      lockfileVersion: 3,
      packages: { "": { ...root, dependencies: { dep: "*" } }, "node_modules/dep": { link: true } },
    }),
  );
});
