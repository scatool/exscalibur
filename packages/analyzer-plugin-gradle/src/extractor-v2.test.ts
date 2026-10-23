import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { convertGradleConfigurationsV2, type GradleConfiguration } from "./extractor-v2.ts";

const config = (name: string, missing: boolean): GradleConfiguration => ({
  rootOrigin: { id: "project :", path: ":" },
  configurationName: name,
  scope: "runtime",
  allDependencies: [
    {
      id: "shared",
      origin: { id: "project :", path: ":" },
      isDirect: true,
      isProject: false,
      coordinates: { group: "org.example", module: "shared", version: "1" },
      dependencies: missing ? ["unreported"] : [],
    },
  ],
});
test("Gradle configuration observations keep native contexts and unknown target coverage", () => {
  const result = convertGradleConfigurationsV2(
    [config("runtimeClasspath", true), config("testRuntimeClasspath", false)],
    { ":": { name: "app", group: "org.example", version: "1", buildFile: "build.gradle" } },
    "build.gradle",
    "test",
  );
  validateResultV2(result);
  expect(result.graphs).toHaveLength(2);
  const runtime = result.graphs.find((graph) => graph.roots[0]!.scope === "runtimeClasspath")!;
  const testGraph = result.graphs.find(
    (graph) => graph.roots[0]!.scope === "testRuntimeClasspath",
  )!;
  expect(queryDependenciesV2(result, { graph: runtime.id, root: "root" })).toMatchObject({
    definite: ["node:shared"],
    completeness: "unknown",
    declarations: [{ dependency: { status: "unresolved" } }],
  });
  expect(queryDependenciesV2(result, { graph: testGraph.id, root: "root" }).declarations).toEqual(
    [],
  );
});

test("An empty Gradle snapshot cannot prove complete scope enumeration", () => {
  const result = convertGradleConfigurationsV2([], {}, "build.gradle", "test");
  expect(result.graphs[0]).toMatchObject({ rootCompleteness: "unknown", roots: [] });
});

test("Synthesized Gradle project identities retain each configuration's source assertion", () => {
  const result = convertGradleConfigurationsV2(
    [config("runtimeClasspath", false), config("testRuntimeClasspath", false)],
    { ":": { name: "app", group: "", version: "1", buildFile: "build.gradle" } },
    "build.gradle",
    "test",
  );
  validateResultV2(result);
  expect(result.subprojects).toHaveLength(1);
  const observations = result.subprojects[0]!.identityObservations!;
  expect(observations).toHaveLength(2);
  expect(
    observations
      .map((observation) => JSON.parse(observation.source.key!)[2])
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(["runtimeClasspath", "testRuntimeClasspath"]);
  expect(observations.every((observation) => observation.synthesizedPurl)).toBe(true);
});
