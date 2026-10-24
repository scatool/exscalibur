import { expect, test } from "vite-plus/test";
import { convertConanGraphV2, extractorV2 } from "./index-v2.ts";
import { parseResultV2, queryDependenciesV2 } from "@scatool/analyzer-core";
import type { ConanFileGraph } from "./types.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(): ConanFileGraph {
  return {
    graph: {
      root: { "0": "app" },
      error: null,
      nodes: {
        "0": {
          name: "app",
          version: "1",
          recipe: "Consumer",
          context: "host",
          dependencies: {
            "1": { direct: true, require: "lib/[>=1]", libs: true },
            "2": { direct: true, require: "lib/1", build: true },
            "3": { direct: false, require: "transitive/1", libs: true },
          },
        },
        "1": {
          name: "lib",
          version: "1",
          recipe: "Cache",
          package_id: "host-binary",
          context: "host",
          dependencies: { "3": { direct: true, require: "transitive/1", libs: true } },
        },
        "2": {
          name: "lib",
          version: "1",
          recipe: "Cache",
          package_id: "build-binary",
          context: "build",
          dependencies: {},
        },
        "3": {
          name: "transitive",
          version: "1",
          recipe: "Cache",
          context: "host",
          dependencies: {},
        },
      },
    },
  } as unknown as ConanFileGraph;
}

test("native Conan IDs separate equal PURLs, host/build binaries and direct adjacency", () => {
  const result = convertConanGraphV2(fixture(), "conanfile.txt", "test");
  expect(parseResultV2(result)).toEqual(result);
  const graph = result.graphs[0]!;
  expect(graph.nodes.find((node) => node.id === "1")!.purl).toBe(
    graph.nodes.find((node) => node.id === "2")!.purl,
  );
  expect(graph.nodes.find((node) => node.id === "1")!.attributes?.["conan:package_id"]).toBe(
    "host-binary",
  );
  expect(
    graph.edges
      .filter((edge) => edge.from === "0")
      .map((edge) => edge.status === "resolved" && edge.to)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(["1", "2"]);
  const runtime = graph.roots.find((root) => root.scope === "runtime")!;
  const build = graph.roots.find((root) => root.scope === "build")!;
  expect(queryDependenciesV2(result, { graph: graph.id, root: runtime.id }).definite).toEqual([
    "1",
    "3",
  ]);
  expect(queryDependenciesV2(result, { graph: graph.id, root: build.id }).definite).toEqual(["2"]);
  expect(
    graph.edges.find((edge) => edge.from === "0" && edge.status === "resolved" && edge.to === "1")!
      .requested?.specifier,
  ).toBe("lib/[>=1]");
});

test("missing Conan targets and missing adjacency stay incomplete", () => {
  const input = fixture();
  delete input.graph.nodes["3"];
  delete (input.graph.nodes["2"] as Partial<ConanFileGraph["graph"]["nodes"][string]>).dependencies;
  const result = convertConanGraphV2(input, "conanfile.txt", "test");
  const graph = result.graphs[0]!;
  expect(graph.edges.some((edge) => edge.status === "unresolved")).toBe(true);
  expect(graph.nodes.find((node) => node.id === "2")!.dependencyCompleteness).toBe("unknown");
});

test("Conan native errors cannot become empty successful graphs", () => {
  expect(() =>
    convertConanGraphV2({ graph: { error: "failed" } } as ConanFileGraph, "conanfile.txt", "test"),
  ).toThrow();
});

test("Conan executable failures retain unknown coverage and an issue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conan-v2-"));
  try {
    await writeFile(join(dir, "conanfile.txt"), "[requires]\nlib/1\n");
    const result = await extractorV2.extract(
      dir,
      { conanPath: join(dir, "missing-conan") },
      { codebaseId: "test" },
    );
    expect(result.issues.some((issue) => issue.severity === "ERROR")).toBe(true);
    expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nameless root coordinates are explicitly synthesized and versionless", () => {
  const input = fixture();
  input.graph.nodes["0"]!.name = null;
  input.graph.nodes["0"]!.version = null;
  const result = convertConanGraphV2(input, "conanfile.txt", "test");
  expect(result.subprojects[0]!.purl).toBe("pkg:conan/project");
  expect(result.subprojects[0]!.identityObservations?.[0]?.synthesizedPurl).toBe(true);
});

test("empty Conan root maps do not establish complete scope enumeration", () => {
  const input = fixture();
  input.graph.root = {};
  input.graph.nodes = {};
  const result = convertConanGraphV2(input, "conanfile.txt", "test");
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
});
