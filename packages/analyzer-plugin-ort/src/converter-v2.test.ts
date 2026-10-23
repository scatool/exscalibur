import { readFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { PackageURL } from "packageurl-js";
import { parse as parseYaml } from "yaml";
import { expect, test } from "vite-plus/test";
import {
  queryDependenciesV2,
  validateResultV2,
  type AnalyzerResultV2,
} from "@scatool/analyzer-core";
import { convertOrtResultV2 } from "./converter-v2.ts";
import { extractorV2 } from "./extractor-v2.ts";
import type { OrtAnalyzerResult, OrtResultFile } from "./model.ts";

const options = { codebase: "example:ort-input", evidenceFile: "reports/analyzer-result.json" };
async function fixture(path: string): Promise<AnalyzerResultV2> {
  const parsed = parseYaml(await readFile(join(import.meta.dirname, "__fixtures__", path), "utf8"));
  const native = (parsed as OrtResultFile).analyzer?.result ?? (parsed as OrtAnalyzerResult);
  return convertOrtResultV2(native, options);
}

function closure(result: AnalyzerResultV2, projectSuffix: string, scope: string) {
  for (const graph of result.graphs) {
    const root = graph.roots.find(
      (root) => root.project.definitionFile.endsWith(projectSuffix) && root.scope === scope,
    );
    if (!root) continue;
    const reached = queryDependenciesV2(result, { graph: graph.id, root: root.id });
    return {
      ...reached,
      purls: [
        ...new Set(reached.definite.map((id) => graph.nodes.find((node) => node.id === id)!.purl)),
      ].sort(),
    };
  }
  throw new Error(`Missing test root: ${projectSuffix}/${scope}`);
}

test("native ORT fragments preserve consumed project contexts and exact project/scope ownership", async () => {
  const result = await fixture("gradle/multimodule/analyzer-result.json");
  validateResultV2(result);
  expect(result.subprojects).toHaveLength(3); // Includes the root project with no dependency scopes.
  expect(result.graphs).toHaveLength(1);
  const compile = closure(result, "app/build.gradle", "compileClasspath");
  const runtime = closure(result, "app/build.gradle", "runtimeClasspath");
  const lib = closure(result, "lib/build.gradle", "compileClasspath");
  expect(lib.purls).toEqual(["pkg:maven/org.slf4j/slf4j-api@2.0.7"]);
  expect(compile.purls).toContain("pkg:maven/multimodule-example/lib");
  expect(compile.purls).toContain("pkg:maven/com.google.guava/guava@31.1-jre");
  expect(compile.purls).not.toContain("pkg:maven/org.slf4j/slf4j-api@2.0.7");
  expect(runtime.purls).toContain("pkg:maven/org.slf4j/slf4j-api@2.0.7");
  expect(compile.purls).not.toContain("pkg:maven/junit/junit@4.13.2");
  expect(closure(result, "app/build.gradle", "testCompileClasspath").purls).toContain(
    "pkg:maven/org.hamcrest/hamcrest-core@1.3",
  );
  expect(compile.completeness).toBe("complete");
  const views = result.graphs[0]!.nodes.filter(
    (node) => node.purl === "pkg:maven/multimodule-example/lib" && node.locator,
  );
  expect(views).toHaveLength(2);
  expect(
    views
      .map((node) => node.attributes?.["ort:fragment"])
      .sort((left, right) => Number(left) - Number(right)),
  ).toEqual([0, 1]);
});

test("legacy scope_roots graphs preserve omitted package index zero and transitive edges", async () => {
  const result = await fixture("yaml/dependency-graph/analyzer-result.yml");
  expect(closure(result, "pom.xml", "test").purls).toEqual([
    "pkg:maven/junit/junit@4.12",
    "pkg:maven/org.hamcrest/hamcrest-core@1.3",
    "pkg:maven/org.mockito/mockito-all@1.10.19",
  ]);
  expect(result.graphs[0]!.nodes.filter((node) => node.locator)).toHaveLength(3);
});

test("native npm fixtures produce valid v2 graphs without flattening project identities", async () => {
  for (const path of [
    "npm/basic/analyzer-result.json",
    "npm/workspace/analyzer-result.json",
    "npm/wrapped-result-file/analyzer-result.json",
  ]) {
    const result = await fixture(path);
    validateResultV2(result);
    expect(result.subprojects.length).toBeGreaterThan(0);
    for (const graph of result.graphs) {
      for (const root of graph.roots) {
        const node = graph.nodes.find((node) => node.id === root.node)!;
        expect(node.project).toEqual(root.project);
      }
    }
  }
});

test("v2 file extractor imports native fixture observations with explicit source namespaces", async () => {
  const result = await extractorV2.extract(
    join(import.meta.dirname, "__fixtures__/gradle/multimodule"),
    undefined,
    { codebaseId: "example:gradle-fixture" },
  );
  expect(result.codebase).toBe("example:gradle-fixture");
  expect(result.formatVersion).toBe(2);
  expect(result.issues).toEqual([]);
  expect(closure(result, "lib/build.gradle", "runtimeClasspath").purls).toEqual([
    "pkg:maven/org.slf4j/slf4j-api@2.0.7",
  ]);
  expect(result.graphs[0]!.source.files).toEqual(["analyzer-result.json"]);
});

test("empty projects and explicitly empty scopes survive conversion", () => {
  const result = convertOrtResultV2(
    {
      projects: [
        { id: "NPM::empty:1", definition_file_path: "empty/package.json", scope_names: [] },
        {
          id: "NPM::app:1",
          definition_file_path: "app/package.json",
          scope_names: ["dependencies"],
        },
      ],
      dependency_graphs: {
        NPM: { packages: [], nodes: [], edges: [], scopes: { ":app:1:dependencies": [] } },
      },
    },
    options,
  );
  expect(result.subprojects).toHaveLength(2);
  const reached = closure(result, "app/package.json", "dependencies");
  expect(reached.purls).toEqual([]);
  expect(reached.completeness).toBe("complete");
});

test("a declared scope without graph information is unknown rather than an asserted empty closure", () => {
  const result = convertOrtResultV2(
    {
      projects: [
        {
          id: "NPM::app:1",
          definition_file_path: "app/package.json",
          scope_names: ["dependencies"],
        },
      ],
    },
    options,
  );
  const reached = closure(result, "app/package.json", "dependencies");
  expect(reached.purls).toEqual([]);
  expect(reached.completeness).toBe("unknown");
  expect(result.issues.some((issue) => issue.code === "ort.unreported_scopes")).toBe(true);
});

test("native scope names containing colons are preserved", () => {
  const result = convertOrtResultV2(
    {
      projects: [
        { id: "NPM::app:1", definition_file_path: "package.json", scope_names: ["custom:scope"] },
      ],
      dependency_graphs: { NPM: { packages: [], scopes: { ":app:1:custom:scope": [] } } },
    },
    options,
  );
  expect(result.graphs[0]!.roots[0]!.scope).toBe("custom:scope");
});

test("missing native dependency views retain known dependency presence and unknown outgoing adjacency", () => {
  const result = convertOrtResultV2(
    {
      projects: [
        { id: "NPM::app:1", definition_file_path: "package.json", scope_names: ["dependencies"] },
      ],
      packages: [{ id: "NPM::foo:1", purl: "pkg:npm/foo@1" }],
      dependency_graphs: {
        NPM: {
          packages: ["NPM::foo:1"],
          scopes: { ":app:1:dependencies": [{ root: 0, fragment: 7 }] },
          nodes: [{}],
          edges: [],
        },
      },
    },
    options,
  );
  const reached = closure(result, "package.json", "dependencies");
  expect(reached.completeness).toBe("unknown");
  expect(reached.purls).toEqual(["pkg:npm/foo@1"]);
  expect(reached.declarations).toEqual([]);
  expect(result.issues.some((issue) => issue.code === "ort.missing_dependency_node")).toBe(true);
});

test("legacy repeated view issues are merged independent of tree ordering", () => {
  const references = [
    { pkg: 0 },
    { pkg: 0, issues: [{ severity: "ERROR", message: "Unresolved transitive dependency" }] },
  ];
  const convert = (scope_roots: typeof references) =>
    convertOrtResultV2(
      {
        projects: [
          { id: "NPM::app:1", definition_file_path: "package.json", scope_names: ["dependencies"] },
        ],
        packages: [{ id: "NPM::foo:1" }],
        dependency_graphs: {
          NPM: {
            packages: ["NPM::foo:1"],
            scopes: { ":app:1:dependencies": [{ root: 0 }] },
            scope_roots,
          },
        },
      },
      options,
    );
  const forward = convert(references);
  const backward = convert([...references].reverse());
  expect(forward).toEqual(backward);
  expect(closure(forward, "package.json", "dependencies").completeness).toBe("partial");
  expect(forward.issues.some((issue) => issue.message === "Unresolved transitive dependency")).toBe(
    true,
  );
});

test("native scope observations stay on graphs rather than conflicting in the project catalog", () => {
  const project = { id: "NPM::app:1", definition_file_path: "package.json", scope_names: [] };
  const result = convertOrtResultV2({ projects: [project] }, options);
  expect(result.subprojects[0]!.attributes).toBeUndefined();
  expect(result.graphs[0]!.attributes?.["ort:projectScopes"]).toEqual([project]);
  expect(result.graphs[0]!.rootCompleteness).toBe("complete");
  const unknown = convertOrtResultV2(
    { projects: [{ id: project.id, definition_file_path: project.definition_file_path }] },
    options,
  );
  expect(unknown.graphs[0]!.rootCompleteness).toBe("unknown");
});

test("conflicting complete legacy dependency sets do not become a union", () => {
  expect(() =>
    convertOrtResultV2(
      {
        dependency_graphs: {
          NPM: {
            packages: ["NPM::foo:1", "NPM::bar:1"],
            scopes: {},
            scope_roots: [{ pkg: 0, dependencies: [{ pkg: 1 }] }, { pkg: 0 }],
          },
        },
      },
      options,
    ),
  ).toThrow("Conflicting dependency sets");
});

test("explicit native identity is resolved before project/package catalogs regardless of entry order", () => {
  const purl = "pkg:maven/org.example/app@1?type=jar";
  const result = convertOrtResultV2(
    {
      projects: [
        { id: "Maven:org.example:app:1", definition_file_path: "pom.xml", scope_names: [] },
      ],
      packages: [{ id: "Maven:org.example:app:1", purl }],
    },
    options,
  );
  expect(result.subprojects[0]!.purl).toBe(purl);
  expect(result.packages[0]!.purl).toBe(purl);
  expect(() =>
    convertOrtResultV2(
      {
        packages: [
          { id: "NPM::foo:1", purl: "pkg:npm/foo@1" },
          { id: "NPM::foo:1", purl: "pkg:npm/foo@1?repository_url=https%3A%2F%2Fexample.com" },
        ],
      },
      options,
    ),
  ).toThrow("Conflicting explicit PURLs");
});

test("equal coordinates under different native managers keep project scope ownership", () => {
  const result = convertOrtResultV2(
    {
      projects: [
        { id: "Maven:org.example:app:1", definition_file_path: "pom.xml", scope_names: ["same"] },
        {
          id: "Gradle:org.example:app:1",
          definition_file_path: "build.gradle",
          scope_names: ["same"],
        },
      ],
      dependency_graphs: {
        Maven: { packages: [], scopes: { "org.example:app:1:same": [] } },
        GradleInspector: { packages: [], scopes: { "org.example:app:1:same": [] } },
      },
    },
    options,
  );
  expect(result.graphs.flatMap((graph) => graph.roots)).toHaveLength(2);
  expect(closure(result, "pom.xml", "same").completeness).toBe("complete");
  expect(closure(result, "build.gradle", "same").completeness).toBe("complete");
});

test("generic PURL fallback is explicit and valid, while valid native coordinates remain preferred", () => {
  const result = convertOrtResultV2(
    {
      packages: [
        { id: "opaque-native-identifier", purl: "invalid" },
        { id: "NPM::foo:1", purl: "invalid" },
      ],
    },
    options,
  );
  expect(result.packages).toHaveLength(2);
  const generic = result.packages.find((pkg) => pkg.synthesizedPurl)!;
  expect(PackageURL.fromString(generic.purl).type).toBe("generic");
  expect(result.packages.some((pkg) => pkg.purl === "pkg:npm/foo@1")).toBe(true);
});

test("malformed native dependency edges fail explicitly instead of dropping relationships", () => {
  expect(() =>
    convertOrtResultV2(
      {
        packages: [{ id: "NPM::foo:1" }],
        dependency_graphs: {
          NPM: {
            packages: ["NPM::foo:1"],
            scopes: {},
            nodes: [{}],
            edges: [{ from: 0, to: 99 }],
          },
        },
      },
      options,
    ),
  ).toThrow("unknown dependency node");
  expect(() =>
    convertOrtResultV2(
      {
        dependency_graphs: {
          NPM: { packages: [], scopes: {}, nodes: [], edges: [{ from: 0, to: 1 }] },
        },
      },
      options,
    ),
  ).toThrow("without an indexed node table");
});
