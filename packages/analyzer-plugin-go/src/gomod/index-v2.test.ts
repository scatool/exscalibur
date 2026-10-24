import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { convertGoModulesV2, parseGoModules, portableGoDiagnostic } from "./index-v2.ts";

test("Go selected versions bind minimum requirements without discarding their original versions", () => {
  const result = convertGoModulesV2(
    {
      Module: { Path: "example.org/app" },
      Require: [{ Path: "example.org/a", Version: "v1.0.0" }],
    },
    [
      { Path: "example.org/app", Main: true },
      { Path: "example.org/a", Version: "v1.2.0", Replace: { Path: "../a" } },
      { Path: "example.org/b", Version: "v2.0.0" },
    ],
    "example.org/app example.org/a@v1.0.0\nexample.org/a@v1.2.0 example.org/b@v1.0.0\n",
    "go.mod",
    "test",
  );
  validateResultV2(result);
  const graph = result.graphs[0]!;
  expect(graph.edges.find((edge) => edge.from === "example.org/a")).toMatchObject({
    to: "example.org/b",
    requested: { specifier: "v1.0.0" },
  });
  expect(queryDependenciesV2(result, { graph: graph.id, root: "root:dependencies" })).toMatchObject(
    { definite: ["example.org/a", "example.org/b"], completeness: "unknown" },
  );
  expect(graph.nodes.find((node) => node.id === "example.org/a")?.artifacts).toMatchObject([
    { location: "../a" },
  ]);
});

test("Go JSON stream handles nested objects and rejects truncated native output", () => {
  expect(parseGoModules('{"Path":"a","Replace":{"Path":"b}"}}\n{"Path":"c"}')).toHaveLength(2);
  expect(() => parseGoModules('{"Path":"a"')).toThrow();
  expect(() => parseGoModules("garbage")).toThrow();
});

test("Go selection observations are independent of host paths and cache hydration", () => {
  const manifest = { Module: { Path: "example.org/app" } };
  const cold = [
    { Path: "example.org/app", Main: true },
    { Path: "example.org/lib", Version: "v1.2.0", Indirect: true, Replace: { Path: "../lib" } },
  ];
  const warm = [
    cold[0]!,
    {
      ...cold[1]!,
      Dir: "/cache/lib",
      GoMod: "/cache/lib/go.mod",
      GoVersion: "1.25",
      Sum: "h1:cached",
      GoModSum: "h1:cached-mod",
      Time: "2025-01-01T00:00:00Z",
      Replace: {
        Path: "../lib",
        Dir: "/checkout/lib",
        GoMod: "/checkout/lib/go.mod",
        GoVersion: "1.25",
      },
    },
  ];
  const convert = (modules: Parameters<typeof convertGoModulesV2>[1]) =>
    convertGoModulesV2(manifest, modules, "", "go.mod", "test");
  expect(convert(warm)).toEqual(convert(cold));
  const node = convert(warm).graphs[0]!.nodes.find((node) => node.id === "example.org/lib")!;
  expect(node.attributes?.["go:module"]).toEqual({
    Path: "example.org/lib",
    Version: "v1.2.0",
    Indirect: true,
    Replace: { Path: "../lib" },
  });
  expect(node.artifacts?.[0]).toMatchObject({
    location: "../lib",
    attributes: { "go:replacement": { Path: "../lib" } },
  });
});

test("Go diagnostics retain native errors with codebase-relative paths", () => {
  expect(
    portableGoDiagnostic("/checkout/repo/test/go.mod:1: invalid module\n", "/checkout/repo"),
  ).toBe("test/go.mod:1: invalid module\n");
  expect(portableGoDiagnostic("C:\\repo\\test\\go.mod:1: invalid module", "C:\\repo")).toBe(
    "test\\go.mod:1: invalid module",
  );
  expect(portableGoDiagnostic("/checkout/repository/file: denied", "/checkout/repo")).toBe(
    "/checkout/repository/file: denied",
  );
});

test("Go versioned replacement identity and explicit direct membership survive projection", () => {
  const result = convertGoModulesV2(
    { Module: { Path: "example.org/app" } },
    [
      {
        Path: "example.org/lib",
        Version: "v1.0.0",
        Indirect: false,
        Replace: { Path: "example.org/fork", Version: "v1.1.0", Dir: "/cache/fork" },
      },
    ],
    "",
    "go.mod",
    "test",
  );
  const node = result.graphs[0]!.nodes.find((node) => node.id === "example.org/lib")!;
  expect(node.attributes?.["go:module"]).toEqual({
    Path: "example.org/lib",
    Version: "v1.0.0",
    Indirect: false,
    Replace: { Path: "example.org/fork", Version: "v1.1.0" },
  });
  expect(node.artifacts?.[0]).toMatchObject({
    location: "example.org/fork",
    attributes: { "go:replacement": { Path: "example.org/fork", Version: "v1.1.0" } },
  });
});
