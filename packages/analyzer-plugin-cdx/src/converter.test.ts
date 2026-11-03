import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { PackageURL } from "packageurl-js";
import { queryDependencies, validateResult, type JsonObject } from "@scatool/analyzer-core";
import { extractCycloneDX } from "./converter.ts";

const component = (ref: string, purl?: string): JsonObject => ({
  "bom-ref": ref,
  name: ref,
  ...(purl && { purl }),
});
function extract(fields: JsonObject) {
  return extractCycloneDX(
    JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", ...fields }),
    {
      codebase: "example:cdx",
      evidenceFile: "bom.cdx.json",
    },
  );
}
function closure(result: ReturnType<typeof extract>) {
  const graph = result.graphs[0]!;
  const root = graph.roots[0]!;
  return { ...queryDependencies(result, { graph: graph.id, root: root.id }), graph, root };
}

test("repeated PURLs retain native adjacency and artifact observations inside one subject graph", () => {
  const result = extract({
    metadata: { component: component("app", "pkg:generic/app@1") },
    components: [
      {
        ...component("widget-a", "pkg:npm/widget@1.0.0"),
        hashes: [{ alg: "SHA-256", content: "one" }],
      },
      {
        ...component("widget-b", "pkg:npm/widget@1.0.0"),
        hashes: [{ alg: "SHA-256", content: "two" }],
      },
      component("react18", "pkg:npm/react@18.3.1"),
      component("react19", "pkg:npm/react@19.0.0"),
    ],
    dependencies: [
      { ref: "app", dependsOn: ["widget-a"] },
      { ref: "widget-a", dependsOn: ["react18"] },
      { ref: "widget-b", dependsOn: ["react19"] },
      { ref: "react18", dependsOn: [] },
      { ref: "react19", dependsOn: [] },
    ],
  });
  validateResult(result);
  const reached = closure(result);
  expect(
    reached.definite
      .map((id) => reached.graph.nodes.find((node) => node.id === id)!.locator)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual(["react18", "widget-a"]);
  expect(reached.completeness).toBe("complete");
  const widgets = reached.graph.nodes.filter((node) => node.purl === "pkg:npm/widget@1.0.0");
  expect(widgets).toHaveLength(2);
  expect(widgets.find((node) => node.locator === "widget-a")!.artifacts?.[0]?.hashes).toEqual({
    "SHA-256": "one",
  });
  expect(
    result.packages.find((pkg) => pkg.purl === "pkg:npm/widget@1.0.0")!.artifacts,
  ).toHaveLength(2);
});

test("missing and invalid PURLs preserve parents, descendants and binary subject with generic identities", () => {
  const result = extract({
    metadata: { component: component("binary") },
    components: [
      {
        ...component("parent", "invalid-purl"),
        components: [component("child", "pkg:npm/child@1")],
      },
    ],
    dependencies: [
      { ref: "binary", dependsOn: ["parent"] },
      { ref: "parent", dependsOn: ["child"] },
      { ref: "child" },
    ],
  });
  expect(result.packages).toHaveLength(3);
  expect(result.subprojects[0]).toMatchObject({
    identityObservations: [expect.objectContaining({ synthesizedPurl: true })],
    attributes: { "cyclonedx:subject": true },
  });
  expect(PackageURL.fromString(result.subprojects[0]!.purl).type).toBe("generic");
  const reached = closure(result);
  expect(reached.definite).toHaveLength(2);
  expect(reached.completeness).toBe("complete");
  expect(result.issues.map((issue) => issue.code)).toEqual(["cyclonedx.invalid_purl"]);
});

test("an explicit empty dependency record differs from an unreported adjacency list", () => {
  const result = extract({
    metadata: { component: component("app") },
    components: [component("known"), component("unreported")],
    dependencies: [{ ref: "app", dependsOn: ["known", "unreported"] }, { ref: "known" }],
  });
  const graph = result.graphs[0]!;
  expect(graph.nodes.find((node) => node.locator === "known")!.dependencyCompleteness).toBe(
    "complete",
  );
  expect(graph.nodes.find((node) => node.locator === "unreported")!.dependencyCompleteness).toBe(
    "unknown",
  );
  expect(closure(result).completeness).toBe("unknown");
});

test("missing referenced entities retain known dependency presence with mandatory generic PURLs", () => {
  const result = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app", dependsOn: ["missing"] }],
  });
  expect(result.issues[0]!.code).toBe("cyclonedx.missing_entity");
  expect(closure(result).definite).toHaveLength(1);
  expect(closure(result).completeness).toBe("unknown");
  const missing = result.graphs[0]!.nodes.find((node) => node.locator === "missing")!;
  expect(PackageURL.fromString(missing.purl).type).toBe("generic");
});

test("containment and provides are preserved without inventing dependency reachability", () => {
  const result = extract({
    metadata: { component: { ...component("app"), components: [component("contained")] } },
    components: [component("provided")],
    dependencies: [{ ref: "app", provides: ["provided"] }],
  });
  expect(closure(result).definite).toEqual([]);
  const root = result.graphs[0]!.nodes.find((node) => node.locator === "app")!;
  expect(root.attributes?.["cyclonedx:children"]).toHaveLength(1);
  expect(root.attributes?.["cyclonedx:dependencyRecords"]).toEqual([
    { ref: "app", provides: ["provided"] },
  ]);
});

test("service dependencies and runtime scope labels retain their native meaning", () => {
  const result = extract({
    metadata: { component: component("app") },
    components: [{ ...component("test-helper"), scope: "excluded" }],
    services: [{ "bom-ref": "service", name: "api" }],
    dependencies: [
      { ref: "app", dependsOn: ["test-helper", "service"] },
      { ref: "service" },
      { ref: "test-helper" },
    ],
  });
  expect(closure(result).definite).toHaveLength(2);
  expect(
    result.graphs[0]!.edges.find((edge) => edge.attributes?.["cyclonedx:scope"] === "excluded")!
      .selection,
  ).toBe("selected");
  expect(
    result.graphs[0]!.nodes.find((node) => node.locator === "service")!.attributes?.[
      "cyclonedx:entityKind"
    ],
  ).toBe("service");
});

test("incomplete compositions prevent an explicitly listed graph from claiming full closure", () => {
  const result = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app" }],
    compositions: [{ aggregate: "incomplete", dependencies: ["app"] }],
  });
  expect(closure(result).completeness).toBe("partial");
});

test("overlapping composition claims are reconciled independently of source order", () => {
  const compositions = [
    { aggregate: "incomplete", dependencies: ["app"] },
    { aggregate: "unknown", dependencies: ["app"] },
  ];
  const first = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app" }],
    compositions,
  });
  const second = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app" }],
    compositions: [...compositions].reverse(),
  });
  expect(closure(first).completeness).toBe("unknown");
  expect(closure(second).completeness).toBe("unknown");
});

test("complete composition claims do not turn unreported topology into a fabricated empty leaf", () => {
  const result = extract({
    metadata: { component: component("app") },
    compositions: [{ aggregate: "complete", dependencies: ["app"] }],
  });
  expect(closure(result).completeness).toBe("unknown");
  expect(result.issues[0]!.code).toBe("cyclonedx.missing_dependency_record");
  const conflicting = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app" }],
    compositions: [
      { aggregate: "complete", dependencies: ["app"] },
      { aggregate: "incomplete", dependencies: ["app"] },
    ],
  });
  expect(closure(conflicting).completeness).toBe("partial");
  expect(conflicting.issues[0]!.code).toBe("cyclonedx.conflicting_completeness");
});

test("external BOM-Links remain attributed external descriptions rather than missing local components", () => {
  const ref = "urn:cdx:8cd05e23-0e18-48b5-a704-d49f1c52c908/1#library";
  const result = extract({
    metadata: { component: component("app") },
    dependencies: [{ ref: "app", dependsOn: [ref] }],
  });
  expect(closure(result).definite).toHaveLength(1);
  expect(closure(result).completeness).toBe("unknown");
  expect(result.issues).toMatchObject([{ code: "cyclonedx.external_reference", severity: "HINT" }]);
});

test("UTF-8 BOM input and reordered identical entity fields preserve native identity", () => {
  const result = extractCycloneDX(
    `\uFEFF${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        component("a", "pkg:npm/a@1"),
        { purl: "pkg:npm/a@1", name: "a", "bom-ref": "a" },
      ],
    })}`,
    { codebase: "example:cdx", evidenceFile: "bom.cdx.json" },
  );
  expect(result.packages).toHaveLength(1);
  expect(result.graphs[0]!.nodes).toHaveLength(1);
});

test("conflicting native dependency lists and entity identities are rejected instead of unioned", () => {
  expect(() =>
    extract({ components: [component("a", "pkg:npm/a@1"), component("a", "pkg:npm/a@2")] }),
  ).toThrow("Conflicting CycloneDX entity reference");
  expect(() =>
    extract({
      components: [component("a"), component("b")],
      dependencies: [{ ref: "a" }, { ref: "a", dependsOn: ["b"] }],
    }),
  ).toThrow("Conflicting CycloneDX dependency lists");
});

test("all existing CycloneDX fixtures keep valid identities and graph references", async () => {
  const fixtures = join(import.meta.dirname, "__fixtures__");
  for (const file of await readdir(fixtures)) {
    if (!file.endsWith(".cdx.json")) continue;
    const result = extractCycloneDX(await readFile(join(fixtures, file), "utf8"), {
      codebase: "example:cdx",
      evidenceFile: file,
    });
    validateResult(result);
    expect(result.packages.length, file).toBeGreaterThan(0);
  }
});
