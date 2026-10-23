import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { convertMavenTreeV2 } from "./extractor-v2.ts";

const node = (artifactId: string) => ({ groupId: "org.example", artifactId, version: "1" });
test("Maven tree occurrences retain different exclusions and classified artifact identities", () => {
  const result = convertMavenTreeV2(
    {
      ...node("app"),
      children: [
        {
          ...node("shared"),
          scope: "compile",
          children: [{ ...node("a"), classifier: "tests", type: "test-jar" }],
        },
        { ...node("shared"), scope: "test", children: [{ ...node("b"), optional: "true" }] },
      ],
    },
    "pom.xml",
    "test",
  );
  validateResultV2(result);
  const graph = result.graphs[0]!;
  const closure = (root: string) => queryDependenciesV2(result, { graph: graph.id, root });
  expect(closure("root:compile").definite).toEqual(["tree/0", "tree/0/0"]);
  expect(closure("root:test").definite).toEqual(["tree/1", "tree/1/0"]);
  expect(
    result.packages.some(
      (pkg) => pkg.purl.includes("classifier=tests") && pkg.purl.includes("type=test-jar"),
    ),
  ).toBe(true);
  expect(graph.edges.find((edge) => edge.from === "tree/1")).toMatchObject({ optional: true });
  expect(graph.edges.every((edge) => !edge.requested)).toBe(true);
});

test("Maven successful empty dependency tree retains a known empty project root", () => {
  const result = convertMavenTreeV2(node("app"), "pom.xml", "test");
  expect(
    queryDependenciesV2(result, {
      graph: result.graphs[0]!.id,
      root: "root:maven:dependency-tree",
    }),
  ).toMatchObject({ definite: [], completeness: "complete" });
});
