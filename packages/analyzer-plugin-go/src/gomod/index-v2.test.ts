import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { convertGoModulesV2, parseGoModules } from "./index-v2.ts";

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
