import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";

test("default UV extractor preserves native frozen export packages, artifacts and adjacency", async () => {
  const result = await extractor.extract(
    join(import.meta.dirname, "__fixtures__", "basic"),
    undefined,
    { codebaseId: "example:uv-fixture" },
  );
  validateResultV2(result);
  expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
  expect(result.packages).toHaveLength(6);
  expect(result.subprojects).toHaveLength(1);
  const subject = result.subprojects[0]!;
  expect(subject.identityObservations?.[0]?.synthesizedPurl).toBe(true);
  expect(subject.purl).toMatch(/^pkg:generic\/excalibur-cyclonedx\/component-/);
  const dependencies = result.packages.filter((pkg) => pkg.purl !== subject.purl);
  expect(dependencies.map((pkg) => pkg.purl)).toEqual([
    "pkg:pypi/certifi@2025.1.31",
    "pkg:pypi/charset-normalizer@3.4.1",
    "pkg:pypi/idna@3.10",
    "pkg:pypi/requests@2.32.3",
    "pkg:pypi/urllib3@2.3.0",
  ]);
  const graph = result.graphs[0]!;
  const requests = graph.nodes.find((node) => node.purl === "pkg:pypi/requests@2.32.3")!;
  expect(
    graph.edges
      .filter((edge) => edge.from === requests.id && edge.status === "resolved")
      .map((edge) => graph.nodes.find((node) => node.id === edge.to)!.purl)
      .sort(),
  ).toEqual([
    "pkg:pypi/certifi@2025.1.31",
    "pkg:pypi/charset-normalizer@3.4.1",
    "pkg:pypi/idna@3.10",
    "pkg:pypi/urllib3@2.3.0",
  ]);
  expect(
    dependencies.every((pkg) =>
      pkg.artifacts?.some((artifact) =>
        artifact.location?.startsWith("https://files.pythonhosted.org/"),
      ),
    ),
  ).toBe(true);
  expect(graph.source.extractor).toBe("uv");
});
