import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { PackageURL } from "packageurl-js";
import { queryDependenciesV2, validateResultV2, type JsonObject } from "@scatool/analyzer-core";
import { extractSpdxV2 } from "./converter-v2.ts";

const pkg = (id: string, purl?: string): JsonObject => ({
  type: "software_Package",
  spdxId: id,
  name: id,
  ...(purl && { packageUrl: purl }),
});
const relationship = (from: string, to: string[], more: JsonObject = {}): JsonObject => ({
  type: "Relationship",
  from,
  to,
  relationshipType: "dependsOn",
  ...more,
});
function extract(elements: JsonObject[], roots: string[] = ["app"]) {
  return extractSpdxV2(
    JSON.stringify({
      type: "SpdxDocument",
      spdxId: "document",
      creationInfo: { specVersion: "3.0.1" },
      rootElement: roots,
      element: elements,
    }),
    {
      codebase: "example:spdx",
      evidenceFile: "bom.spdx.json",
    },
  );
}
function closure(result: ReturnType<typeof extract>, scope = "dependencies", subject = "app") {
  const graph = result.graphs[0]!;
  const root = graph.roots.find(
    (root) =>
      root.scope === scope &&
      root.project.definitionFile.endsWith(`=${encodeURIComponent(subject)}`),
  )!;
  const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
  const locators = [...closure.definite, ...closure.conditional]
    .map((id) => graph.nodes.find((node) => node.id === id)!.locator)
    .sort((a, b) => String(a).localeCompare(String(b)));
  return { ...closure, graph, root, locators };
}

test("native IDs with equal PURLs retain different adjacency and exact imported subject ownership", () => {
  const result = extract(
    [
      pkg("app", "pkg:generic/app@1"),
      pkg("other", "pkg:generic/app@1"),
      pkg("widget-a", "pkg:npm/widget@1"),
      pkg("widget-b", "pkg:npm/widget@1"),
      pkg("react18", "pkg:npm/react@18"),
      pkg("react19", "pkg:npm/react@19"),
      relationship("app", ["widget-a"]),
      relationship("other", ["widget-b"]),
      relationship("widget-a", ["react18"]),
      relationship("widget-b", ["react19"]),
    ],
    ["app", "other"],
  );
  validateResultV2(result);
  expect(result.subprojects).toHaveLength(2);
  expect(new Set(result.subprojects.map((project) => project.purl)).size).toBe(1);
  expect(closure(result).locators).toEqual(["react18", "widget-a"]);
  expect(closure(result, "dependencies", "other").locators).toEqual(["react19", "widget-b"]);
});

test("lifecycle scopes and optional/provided kinds remain independent with explicit applicability", () => {
  const result = extract([
    pkg("app"),
    pkg("optional"),
    pkg("provided"),
    pkg("build"),
    relationship("app", ["optional"], {
      type: "LifecycleScopedRelationship",
      relationshipType: "hasOptionalDependency",
      scope: "runtime",
    }),
    relationship("app", ["provided"], {
      type: "LifecycleScopedRelationship",
      relationshipType: "hasProvidedDependency",
      scope: "runtime",
    }),
    relationship("app", ["build"], { type: "LifecycleScopedRelationship", scope: "build" }),
  ]);
  const runtime = closure(result, "runtime");
  expect(runtime.locators).toEqual(["optional", "provided"]);
  expect(runtime.definite).toEqual([]);
  const bindings = runtime.graph.edges.filter((edge) => edge.from === runtime.root.node);
  expect(bindings.find((edge) => edge.kind === "hasOptionalDependency")).toMatchObject({
    optional: true,
    selection: "conditional",
    condition: { language: "spdx:lifecycle/v1", expression: { scope: "runtime" } },
  });
  expect(bindings.find((edge) => edge.kind === "hasProvidedDependency")).toBeDefined();
  expect(closure(result, "build").locators).toEqual(["build"]);
});

test("missing PURLs and missing referenced metadata retain all dependency parents and targets", () => {
  const result = extract([
    pkg("app"),
    pkg("parent", "invalid-purl"),
    relationship("app", ["parent"]),
    relationship("parent", ["external-package"]),
  ]);
  expect(result.packages).toHaveLength(3);
  for (const component of result.packages)
    expect(PackageURL.fromString(component.purl).type).toBe("generic");
  expect(closure(result).locators).toEqual(["external-package", "parent"]);
  expect(closure(result).completeness).toBe("unknown");
  expect(result.issues.map((issue) => issue.code).sort()).toEqual([
    "spdx.invalid_purl",
    "spdx.missing_element",
  ]);
});

test("NoneElement and NoAssertionElement express coverage instead of fake components", () => {
  const none = "https://spdx.org/rdf/3.0.1/terms/Core/NoneElement";
  const result = extract([
    pkg("app"),
    ...["dependsOn", "hasOptionalDependency", "hasProvidedDependency"].map((kind) =>
      relationship("app", [none], { relationshipType: kind }),
    ),
  ]);
  expect(result.packages).toHaveLength(1);
  expect(closure(result).definite).toEqual([]);
  expect(closure(result).completeness).toBe("complete");
  const unknown = extract([
    pkg("app"),
    relationship("app", ["https://spdx.org/rdf/3.0.1/terms/Core/NoAssertionElement"]),
  ]);
  expect(unknown.packages).toHaveLength(1);
  expect(closure(unknown).completeness).toBe("unknown");
  expect(closure(unknown).declarations).toEqual([]);
  expect(unknown.graphs[0]!.attributes?.["spdx:assertions"]).toHaveLength(1);
  expect(() => extract([pkg("app"), relationship("app", [none, "other"])])).toThrow(
    "NoneElement cannot be combined",
  );
});

test("missing assertions and empty to arrays never claim complete empty adjacency", () => {
  expect(closure(extract([pkg("app")])).completeness).toBe("unknown");
  expect(() => extract([pkg("app"), relationship("app", [])])).toThrow(
    "explicitly use NoneElement",
  );
});

test("bundle roots resolve to analyzed subjects and containment stays native metadata", () => {
  const result = extract(
    [
      { type: "software_Sbom", spdxId: "bundle", rootElement: ["app"] },
      pkg("app"),
      pkg("contained"),
      relationship("app", ["contained"], { relationshipType: "contains" }),
    ],
    ["bundle"],
  );
  expect(result.subprojects).toHaveLength(1);
  expect(closure(result).locators).toEqual([]);
  expect(result.graphs[0]!.attributes?.["spdx:assertions"]).toHaveLength(2);
});

test("explicit identity conflicts fail while a valid alternative PURL takes precedence over invalid input", () => {
  expect(() =>
    extract([{ ...pkg("app", "pkg:npm/app@1"), software_packageUrl: "pkg:npm/app@2" }]),
  ).toThrow("Conflicting SPDX package PURLs");
  const result = extract([
    {
      ...pkg("app", "invalid"),
      externalIdentifier: [{ externalIdentifierType: "packageUrl", identifier: "pkg:npm/app@1" }],
    },
  ]);
  expect(result.subprojects[0]!.purl).toBe("pkg:npm/app@1");
  expect(result.subprojects[0]!.identityObservations?.[0]?.synthesizedPurl).toBe(false);
});

test("all native SPDX fixture serializations produce valid graphs without dropping PURL-less packages", async () => {
  const fixtures = join(import.meta.dirname, "__fixtures__");
  for (const file of await readdir(fixtures)) {
    if (!/\.spdx\.(json|jsonld|ya?ml)$/.test(file)) continue;
    const result = extractSpdxV2(await readFile(join(fixtures, file), "utf8"), {
      codebase: "example:spdx",
      evidenceFile: file,
    });
    validateResultV2(result);
    expect(result.packages.length, file).toBeGreaterThan(0);
  }
});

test("time-limited None and complete claims remain conditional coverage without contradictory interval diagnostics", () => {
  const none = "https://spdx.org/rdf/3.0.1/terms/Core/NoneElement";
  const timed = ["dependsOn", "hasOptionalDependency", "hasProvidedDependency"].map((kind) =>
    relationship("app", [none], {
      relationshipType: kind,
      startTime: "2020-01-01T00:00:00Z",
      endTime: "2020-12-31T23:59:59Z",
    }),
  );
  const result = extract([pkg("app"), ...timed]);
  expect(closure(result).completeness).toBe("unknown");
  const intervals = extract([
    pkg("app"),
    pkg("one"),
    pkg("two"),
    relationship("app", ["one"], {
      completeness: "complete",
      startTime: "2020-01-01T00:00:00Z",
      endTime: "2020-12-31T23:59:59Z",
    }),
    relationship("app", ["two"], {
      completeness: "complete",
      startTime: "2021-01-01T00:00:00Z",
      endTime: "2021-12-31T23:59:59Z",
    }),
  ]);
  expect(intervals.issues).toEqual([]);
  expect(closure(intervals).definite).toEqual([]);
  expect(closure(intervals).locators).toEqual(["one", "two"]);
});

test("flattened external identifiers supply PURLs and unresolved identifiers are diagnosed", () => {
  const result = extract([
    { ...pkg("app"), externalIdentifier: ["identifier", "absent"] },
    {
      type: "ExternalIdentifier",
      spdxId: "identifier",
      externalIdentifierType: "packageUrl",
      identifier: "pkg:npm/app@1",
    },
  ]);
  expect(result.subprojects[0]!.purl).toBe("pkg:npm/app@1");
  expect(result.issues[0]!.code).toBe("spdx.missing_identifier");
});

test("rootless and cyclic collection expansion cannot make remaining subject coverage complete", () => {
  const result = extract(
    [
      pkg("app"),
      { type: "software_Sbom", spdxId: "unreported" },
      { type: "Bundle", spdxId: "cycle", rootElement: ["cycle"] },
    ],
    ["app", "unreported", "cycle"],
  );
  expect(result.subprojects).toHaveLength(1);
  expect(result.graphs[0]!.rootCompleteness).toBe("partial");
  expect(
    result.issues.filter((issue) => issue.code === "spdx.root_expansion_incomplete"),
  ).toHaveLength(2);
});

test("anonymous source IDs cannot collide with an explicit native element ID", () => {
  const result = extract([
    { type: "software_Package", name: "anonymous", packageUrl: "pkg:npm/anonymous@1" },
    pkg("0", "pkg:npm/named@1"),
    pkg("app"),
    relationship("app", ["0"]),
  ]);
  expect(result.packages).toHaveLength(3);
  expect(closure(result).locators).toEqual(["0"]);
  expect(
    result.graphs[0]!.nodes.find((node) => node.purl === "pkg:npm/anonymous@1")!.locator,
  ).toBeUndefined();
});
