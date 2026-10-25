import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import { convertGradleConfigurations, type GradleConfiguration } from "./extractor.ts";

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
  const result = convertGradleConfigurations(
    [config("runtimeClasspath", true), config("testRuntimeClasspath", false)],
    { ":": { name: "app", group: "org.example", version: "1", buildFile: "build.gradle" } },
    "build.gradle",
    "test",
  );
  validateResult(result);
  expect(result.graphs).toHaveLength(2);
  const runtime = result.graphs.find((graph) => graph.roots[0]!.scope === "runtimeClasspath")!;
  const testGraph = result.graphs.find(
    (graph) => graph.roots[0]!.scope === "testRuntimeClasspath",
  )!;
  expect(queryDependencies(result, { graph: runtime.id, root: "root" })).toMatchObject({
    definite: ["node:shared"],
    completeness: "unknown",
    declarations: [{ dependency: { status: "unresolved" } }],
  });
  expect(queryDependencies(result, { graph: testGraph.id, root: "root" }).declarations).toEqual([]);
});

test("An empty Gradle snapshot cannot prove complete scope enumeration", () => {
  const result = convertGradleConfigurations([], {}, "build.gradle", "test");
  expect(result.graphs[0]).toMatchObject({ rootCompleteness: "unknown", roots: [] });
});

test("Gradle accepts identical repeated native records without duplicating views or edges", () => {
  const input = config("providedCompile", true);
  const projects = { ":": { name: "app", group: "org.example", version: "1" } };
  const expected = convertGradleConfigurations([input], projects, "build.gradle", "test");
  input.allDependencies.push(structuredClone(input.allDependencies[0]!));
  const actual = convertGradleConfigurations([input], projects, "build.gradle", "test");
  validateResult(actual);
  expect(actual).toEqual(expected);
  expect(actual.graphs[0]!.nodes).toHaveLength(2);
  expect(actual.graphs[0]!.edges).toHaveLength(2);
});

test.each([
  { coordinates: { group: "org.example", module: "different", version: "1" } },
  { dependencies: ["different"] },
  { isDirect: false },
  { isProject: true },
  { origin: { id: "project :other", path: ":other" } },
  { repositoryUrl: "https://example.invalid/maven" },
])("Gradle rejects conflicting facts for a repeated native ID: %j", (change) => {
  const input = config("runtimeClasspath", false);
  input.allDependencies.push({ ...structuredClone(input.allDependencies[0]!), ...change });
  expect(() => convertGradleConfigurations([input], {}, "build.gradle", "test")).toThrow(
    "Conflicting Gradle dependency ID in configuration: shared",
  );
});

test("Synthesized Gradle project identities retain each configuration's source assertion", () => {
  const result = convertGradleConfigurations(
    [config("runtimeClasspath", false), config("testRuntimeClasspath", false)],
    { ":": { name: "app", group: "", version: "1", buildFile: "build.gradle" } },
    "build.gradle",
    "test",
  );
  validateResult(result);
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
