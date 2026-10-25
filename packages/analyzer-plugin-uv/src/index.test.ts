import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  createDependencyGraph,
  normalizeResult,
  validateResult,
  type AnalyzerResult,
  type JsonObject,
} from "@scatool/analyzer-core";
import { extractor } from "./index.ts";

function snapshotWithStableExportIdentity(result: AnalyzerResult): AnalyzerResult {
  const snapshot = structuredClone(result);
  expect(snapshot.graphs).toHaveLength(1);
  const graph = snapshot.graphs[0]!;
  const graphNamespace = ["uv", "uv.lock"];
  expect(graph.id).toBe(JSON.stringify([...graphNamespace, createDependencyGraph(graph).id]));

  const document = graph.attributes!["cyclonedx:document"] as JsonObject;
  const metadata = graph.attributes!["cyclonedx:metadata"] as JsonObject;
  expect(document.serialNumber).toMatch(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(graph.source.key).toBe(document.serialNumber);
  expect(metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  expect(Number.isFinite(Date.parse(metadata.timestamp as string))).toBe(true);

  // UV creates these two document values on every export. Keep their fields and
  // source-key linkage, but stabilize only their values and the derived graph ID.
  document.serialNumber = "urn:uuid:00000000-0000-0000-0000-000000000000";
  graph.source.key = document.serialNumber;
  metadata.timestamp = "2000-01-01T00:00:00Z";
  snapshot.graphs[0] = createDependencyGraph(graph);
  snapshot.graphs[0].id = JSON.stringify([...graphNamespace, snapshot.graphs[0].id]);

  return normalizeResult(snapshot);
}

test("default UV extractor preserves native frozen export packages, artifacts and adjacency", async () => {
  const result = await extractor.extract(
    join(import.meta.dirname, "__fixtures__", "basic"),
    undefined,
    { codebaseId: "example:uv-fixture" },
  );
  validateResult(result);
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

  expect(snapshotWithStableExportIdentity(result)).toMatchSnapshot();
});
