import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

const directory = join(import.meta.dirname, "__fixtures__/npm-optional-oracle");
const report = JSON.parse(await readFile(join(directory, "native-observations.json"), "utf8")) as {
  tools: { node: string; npm: string; arborist: string };
  cases: {
    id: string;
    lockSha256?: string;
    manifestSha256: string;
    lockGeneration: string | { code: string };
    install: string | { code: string };
    virtual?: {
      nodes: { location: string; name: string; version: string; libc?: string[] }[];
      edges: {
        from: string;
        name: string;
        spec: string;
        rawSpec: string;
        type: string;
        error: string | null;
        to: string | null;
      }[];
    };
    installedManifests: { location: string; manifest: { libc?: string[] } }[];
    actual: { nodes: { name: string; version: string; libc?: string[] }[] };
  }[];
};
const observed = (id: string) => report.cases.find((value) => value.id === id)!;
test("pinned offline native optional matrix distinguishes virtual and installed trees", () => {
  expect(report.tools).toEqual({ node: "v22.23.4", npm: "11.9.0", arborist: "9.2.0" });
  expect(report.cases).toHaveLength(9);
  expect(observed("optional-overrides-required").virtual!.edges).toEqual([
    {
      from: "",
      name: "leaf",
      spec: "file:../packages/leaf-2.0.0.tgz",
      rawSpec: "file:../packages/leaf-2.0.0.tgz",
      type: "optional",
      error: null,
      to: "node_modules/leaf",
    },
  ]);
  for (const id of [
    "optional-missing",
    "optional-omitted",
    "optional-platform-os",
    "optional-platform-cpu",
  ]) {
    const value = observed(id);
    expect(value.install).toBe("success");
    expect(value.virtual!.nodes).toHaveLength(1);
    expect(value.actual.nodes).toEqual([]);
  }
  expect(observed("optional-missing").virtual!.edges[0]!.error).toBe("INVALID");
  expect(observed("optional-platform-ok").actual.nodes.map((n) => n.name)).toEqual(["platform-ok"]);
  expect(observed("required-platform-os").install).toEqual({
    code: "EBADPLATFORM",
    message: "Unsupported platform",
  });
  const libc = observed("optional-platform-libc");
  expect(libc.virtual!.nodes[0]!.libc).toBeUndefined();
  expect(libc.installedManifests[0]!.manifest.libc).toEqual(["!glibc"]);
  const drift = observed("override-only-drift");
  expect(drift.virtual!.edges.find((e) => e.name === "leaf")).toMatchObject({
    rawSpec: "file:../packages/leaf-1.0.0.tgz",
    spec: "file:../../../packages/leaf-2.0.0.tgz",
    error: "INVALID",
  });
  expect(drift.virtual!.nodes.find((n) => n.name === "leaf")!.version).toBe("1.0.0");
  expect(drift.install).toBe("success");
  expect(drift.actual.nodes.find((n) => n.name === "leaf")!.version).toBe("2.0.0");
});
for (const id of [
  "optional-overrides-required",
  "optional-missing",
  "optional-omitted",
  "optional-platform-ok",
  "optional-platform-os",
  "optional-platform-cpu",
  "optional-platform-libc",
  "override-only-drift",
])
  test(`${id}: extraction preserves lock observation, not native install outcome`, async () => {
    const result = await extractorV2.extract(join(directory, id), undefined, {
      codebaseId: `oracle:${id}`,
    });
    validateResultV2(result);
    const manifestText = await readFile(join(directory, id, "package.json"), "utf8");
    expect(createHash("sha256").update(manifestText).digest("hex")).toBe(
      observed(id).manifestSha256,
    );
    const lockText = await readFile(join(directory, id, "package-lock.json"), "utf8");
    expect(createHash("sha256").update(lockText).digest("hex")).toBe(observed(id).lockSha256);
    const lock = JSON.parse(await readFile(join(directory, id, "package-lock.json"), "utf8"));
    const graph = result.graphs.find((g) => g.interpretation === "locked")!;
    expect(graph).toBeDefined();
    expect(
      graph.nodes
        .filter((n) => !n.project)
        .map((n) => n.locator!)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual(
      Object.keys(lock.packages)
        .filter((p) => p.startsWith("node_modules/"))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    for (const node of graph.nodes.filter((n) => !n.project)) {
      const native = lock.packages[node.locator!];
      expect(node.attributes?.["npm:metadata"]).toEqual(native);
      const platform = Object.fromEntries(
        ["os", "cpu", "libc"]
          .filter((key) => native[key] !== undefined)
          .map((key) => [key, native[key]]),
      );
      for (const edge of graph.edges.filter((e) => e.to === node.id && e.selection !== "excluded"))
        expect(edge.condition).toEqual(
          Object.keys(platform).length
            ? { language: "npm:platform/v1", expression: platform }
            : undefined,
        );
    }
    if (id === "optional-overrides-required") {
      const native = observed(id).virtual!.edges[0]!;
      const ordinary = graph.roots.find((r) => r.scope === "dependencies")!;
      expect(graph.edges.filter((e) => e.from === ordinary.node)).toEqual([]);
      const declared = result.graphs.find((g) => g.interpretation === "declared")!;
      const current = declared.roots.find((r) => r.scope === "dependencies")!;
      expect(declared.edges.find((e) => e.from === current.node)?.selection).toBe("excluded");
      const optionalRoot = graph.roots.find((r) => r.scope === "optionalDependencies")!;
      expect(graph.edges.find((e) => e.from === optionalRoot.node)).toMatchObject({
        requested: { name: native.name, specifier: native.spec },
        optional: true,
        status: "resolved",
        selection: "selected",
      });
    }
    if (id === "override-only-drift") {
      expect(result.issues.some((i) => i.code === "npm.manifest_lock_mismatch")).toBe(false);
      expect(
        graph.nodes.find((n) => n.project && n.attributes?.["npm:projectMetadata"])?.attributes?.[
          "npm:projectMetadata"
        ],
      ).toMatchObject({ overrides: JSON.parse(manifestText).overrides });
      expect(graph.nodes.some((n) => n.purl === "pkg:npm/leaf@1.0.0")).toBe(true);
    }
  });
