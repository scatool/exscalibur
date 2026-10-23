import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

test("manifest-only ranges and workspace/alias requests stay declarations with exact scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-manifest-v2-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { foo: "^2 || ^3", ui: "workspace:*", alias: "npm:actual@^1" },
        devDependencies: { test: ">=4" },
        peerDependencies: { host: "*" },
        peerDependenciesMeta: { host: { optional: true } },
      }),
    );
    const result = await extractorV2.extract(directory, undefined, {
      codebaseId: "example:manifest",
    });
    validateResultV2(result);
    expect(result.issues).toEqual([]);
    expect(result.packages).toEqual([]);
    expect(result.subprojects[0]!.purl).toBe("pkg:npm/app@1.0.0");
    const graph = result.graphs[0]!;
    const root = graph.roots.find((root) => root.scope === "dependencies")!;
    const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
    expect(closure.definite).toEqual([]);
    expect(closure.completeness).toBe("unknown");
    expect(
      closure.declarations
        .map((record) => record.dependency.requested.specifier)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(["^2 || ^3", "npm:actual@^1", "workspace:*"]);
    expect(graph.edges.find((edge) => edge.kind === "peerDependencies")).toMatchObject({
      status: "declared",
      optional: true,
      selection: "selected",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unnamed source projects have stable generic PURLs and known empty scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-manifest-v2-"));
  try {
    await writeFile(join(directory, "package.json"), "{}");
    const first = await extractorV2.extract(directory, undefined, {
      codebaseId: "example:manifest",
    });
    const second = await extractorV2.extract(directory, undefined, {
      codebaseId: "example:manifest",
    });
    expect(first).toEqual(second);
    expect(first.subprojects[0]).toMatchObject({
      synthesizedPurl: true,
      definitionFile: "package.json",
    });
    expect(first.subprojects[0]!.purl).toMatch(/^pkg:generic\//);
    const graph = first.graphs[0]!;
    expect(graph.roots).toHaveLength(4);
    for (const root of graph.roots) {
      expect(queryDependenciesV2(first, { graph: graph.id, root: root.id }).completeness).toBe(
        "complete",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manifest fallback does not duplicate projects owned by ancestor lockfiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-manifest-v2-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "package-lock.json"), "{}");
    await writeFile(join(directory, "nested/package.json"), JSON.stringify({ name: "nested" }));
    const result = await extractorV2.extract(directory);
    expect(result.subprojects).toEqual([]);
    expect(result.graphs).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("UTF-8 BOM manifests are readable and invalid request values retain unknown failure coverage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-manifest-v2-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      '\uFEFF{"name":"app","dependencies":{"foo":"^2"}}',
    );
    const valid = await extractorV2.extract(directory);
    expect(valid.issues).toEqual([]);
    expect(valid.subprojects[0]!.purl).toBe("pkg:npm/app");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "app", dependencies: { foo: 42 } }),
    );
    const invalid = await extractorV2.extract(directory);
    expect(invalid.issues).toMatchObject([
      { code: "core.file_extraction_failed", severity: "ERROR" },
    ]);
    expect(invalid.graphs[0]!.rootCompleteness).toBe("unknown");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
