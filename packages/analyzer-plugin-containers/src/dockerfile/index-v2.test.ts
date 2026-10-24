import { expect, test } from "vite-plus/test";
import { parseResultV2, queryDependenciesV2 } from "@scatool/analyzer-core";
import { extractDockerfileV2 } from "./index-v2.ts";

test("FROM declarations preserve source requirements without fabricating resolved images", () => {
  const result = extractDockerfileV2(
    "ARG IMAGE=alpine\nFROM ${IMAGE}:3 AS build\nFROM build AS final\nFROM scratch\nFROM --platform=$TARGETPLATFORM nginx:1\n",
    "apps/a/Dockerfile",
    "repo",
  );
  expect(parseResultV2(result)).toEqual(result);
  expect(result.packages).toEqual([]);
  const graph = result.graphs[0]!;
  expect(graph.context?.["dockerfile:argDefaults"]).toEqual([
    { name: "IMAGE", value: "alpine", line: 1 },
  ]);
  expect(graph.edges.map((edge) => edge.requested?.specifier)).toEqual(["${IMAGE}:3", "nginx:1"]);
  expect(graph.edges.every((edge) => edge.status === "declared" && !("to" in edge))).toBe(true);
  expect(graph.edges[1]?.attributes?.["dockerfile:platform"]).toBe("$TARGETPLATFORM");
  expect(queryDependenciesV2(result, { graph: graph.id, root: "from" })).toMatchObject({
    definite: [],
    conditional: [],
    completeness: "unknown",
  });
});

test("scratch is a known empty FROM declaration scope, unsupported syntax is incomplete", () => {
  const leaf = extractDockerfileV2("FROM scratch");
  expect(queryDependenciesV2(leaf, { graph: leaf.graphs[0]!.id, root: "from" }).completeness).toBe(
    "complete",
  );
  const incomplete = extractDockerfileV2("FROM --unsupported=value alpine");
  expect(incomplete.graphs[0]!.nodes[0]!.dependencyCompleteness).toBe("partial");
  expect(incomplete.issues).toHaveLength(1);
});

test("repeated source identities keep exact Dockerfile ownership", () => {
  const first = extractDockerfileV2("FROM alpine", "a/Dockerfile", "repo");
  const second = extractDockerfileV2("FROM alpine", "b/Dockerfile", "repo");
  expect(first.subprojects[0]!.purl).toBe(second.subprojects[0]!.purl);
  expect(first.graphs[0]!.roots[0]!.project.definitionFile).toBe("a/Dockerfile");
  expect(second.graphs[0]!.roots[0]!.project.definitionFile).toBe("b/Dockerfile");
});

test("continued FROM instructions retain incomplete coverage instead of inventing an image", () => {
  for (const continuation of ["\\", "`"]) {
    const result = extractDockerfileV2(`FROM ${continuation}\n alpine:3`);
    expect(result.graphs[0]!.edges).toEqual([]);
    expect(result.graphs[0]!.nodes[0]!.dependencyCompleteness).toBe("partial");
    expect(result.issues).toHaveLength(1);
  }
});
