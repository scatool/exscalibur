import { expect, test } from "vite-plus/test";
import { convertVcpkgPortsV2, extractorV2 } from "./index-v2.ts";
import { parseResultV2, queryDependenciesV2 } from "@scatool/analyzer-core";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VcpkgPort } from "./types.ts";

test("registry candidates retain separate host/target views and native feature/platform declarations", () => {
  const result = convertVcpkgPortsV2(
    {
      name: "app",
      dependencies: [
        "lib",
        { name: "lib", host: true, features: [{ name: "tls", platform: "windows" }] },
      ],
    },
    {
      lib: {
        name: "lib",
        version: "1",
        "port-version": 2,
        dependencies: [{ name: "unix", platform: "linux" }],
        features: {
          tls: { description: "TLS", dependencies: [{ name: "crypto", platform: "windows" }] },
        },
      },
      unix: { name: "unix", version: "1" },
      crypto: { name: "crypto", version: "1" },
    },
    "vcpkg.json",
    "test",
  );
  expect(parseResultV2(result)).toEqual(result);
  const graph = result.graphs[0]!;
  expect(graph.interpretation).toBe("declared");
  const lib = graph.nodes.filter((node) => node.purl.includes("lib@1"));
  expect(lib).toHaveLength(2);
  expect(lib[0]!.purl).toContain("port_version=2");
  expect(new Set(lib.map((node) => node.attributes?.["vcpkg:domain"]))).toEqual(
    new Set(["host", "target"]),
  );
  const featureEdge = graph.edges.find((edge) => edge.requested?.name === "crypto")!;
  expect(featureEdge.condition?.expression).toEqual({ feature: "tls", platform: "windows" });
  expect(featureEdge.selection).toBe("unknown");
  const closure = queryDependenciesV2(result, {
    graph: graph.id,
    root: graph.roots.find((root) => root.scope === "target")!.id,
  });
  expect(closure.definite).toEqual([]);
  expect(closure.completeness).toBe("partial");
});

test("missing registry candidates retain unresolved requirements and never fabricate versions", () => {
  const result = convertVcpkgPortsV2(
    { dependencies: [{ name: "missing", "version>=": "3" }] },
    {},
    "app/vcpkg.json",
    "test",
  );
  expect(result.subprojects[0]!.purl).toBe("pkg:vcpkg/app");
  expect(result.packages).toEqual([]);
  expect(result.graphs[0]!.edges[0]).toMatchObject({
    status: "unresolved",
    requested: { name: "missing", specifier: ">=3" },
  });
  expect(result.issues[0]!.code).toBe("vcpkg.port_missing");
});

test("registry command failure retains unknown coverage instead of a successful empty graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vcpkg-v2-"));
  try {
    await writeFile(
      join(dir, "vcpkg.json"),
      JSON.stringify({ name: "app", dependencies: ["lib"] }),
    );
    const result = await extractorV2.extract(
      dir,
      { vcpkgPath: join(dir, "missing-vcpkg") },
      { codebaseId: "test" },
    );
    expect(result.issues.some((issue) => issue.severity === "ERROR")).toBe(true);
    expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([
  { name: "app", dependencies: null },
  { name: "app", features: { tls: { description: "TLS", dependencies: null } } },
])("invalid vcpkg dependency lists cannot become complete empty graphs: %j", async (manifest) => {
  expect(() =>
    convertVcpkgPortsV2(manifest as unknown as VcpkgPort, {}, "vcpkg.json", "test"),
  ).toThrow(/dependencies.*array/);
  const dir = await mkdtemp(join(tmpdir(), "vcpkg-invalid-list-"));
  try {
    await writeFile(join(dir, "vcpkg.json"), JSON.stringify(manifest));
    const result = await extractorV2.extract(
      dir,
      { vcpkgPath: join(dir, "missing-vcpkg") },
      { codebaseId: "test" },
    );
    expect(parseResultV2(result)).toEqual(result);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "ERROR",
        message: expect.stringMatching(/dependencies.*array/),
      }),
    ]);
    expect(result.graphs).toEqual([
      expect.objectContaining({ rootCompleteness: "unknown", roots: [], nodes: [], edges: [] }),
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([
  { name: "app" },
  { name: "app", dependencies: [] },
  { name: "app", features: { tls: { description: "TLS", dependencies: [] } } },
])("valid empty vcpkg declarations retain complete roots: %j", (manifest) => {
  const result = convertVcpkgPortsV2(manifest, {}, "vcpkg.json", "test");
  expect(parseResultV2(result)).toEqual(result);
  expect(result.issues).toEqual([]);
  for (const graph of result.graphs)
    for (const root of graph.roots)
      expect(queryDependenciesV2(result, { graph: graph.id, root: root.id })).toMatchObject({
        definite: [],
        conditional: [],
        declarations: [],
        completeness: "complete",
      });
});
