import { createRequire } from "node:module";
import { assertNativeNpmLock } from "./acceptance/native-npm-lock.ts";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { parseResult, queryDependencies, type DependencyGraph } from "@scatool/analyzer-core";

type Native = Record<string, any>;
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const sourceRoot = join(import.meta.dirname, "repositories");
const read = (id: string, file: string) => readFileSync(join(sourceRoot, id, file), "utf8");
const sorted = <T>(values: T[]) =>
  values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const result = (id: string) =>
  parseResult(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
  );

function declarations(graph: DependencyGraph, manifest: Native, file: string) {
  expect(graph.interpretation).toBe("declared");
  expect(graph.rootCompleteness).toBe("complete");
  expect(graph.roots.map((root) => root.scope).sort()).toEqual([...scopes].sort());
  expect(graph.nodes).toHaveLength(5);
  for (const root of graph.roots) {
    expect(root.project.definitionFile).toBe(file);
    const edges = graph.edges.filter((edge) => edge.from === root.node);
    const expected = Object.entries(manifest[root.scope] ?? {});
    expect(sorted(edges.map((edge) => [edge.requested?.name, edge.requested?.specifier]))).toEqual(
      sorted(expected),
    );
    for (const edge of edges) {
      expect(edge).toMatchObject({
        status: "declared",
        selection: "selected",
        kind: root.scope,
        optional: false,
        evidence: [file],
      });
      expect(edge).not.toHaveProperty("to");
      expect(edge).not.toHaveProperty("condition");
    }
    expect(graph.nodes.find((node) => node.id === root.node)).toMatchObject({
      project: root.project,
      dependencyCompleteness: "complete",
    });
  }
  expect(graph.edges).toHaveLength(
    scopes.reduce((sum, scope) => sum + Object.keys(manifest[scope] ?? {}).length, 0),
  );
  const rootIds = new Set(graph.roots.map((root) => root.node));
  expect(
    graph.nodes.filter((node) => !rootIds.has(node.id)).map((node) => node.dependencyCompleteness),
  ).toEqual(["unknown"]);
}

for (const id of ["eslint+eslintrc", "yargs+yargs", "sindresorhus+boxen"]) {
  test(`${id}: every native manifest including deliberately malformed fixtures`, () => {
    const value = result(id);
    const files = readdirSync(join(sourceRoot, id), { recursive: true })
      .filter((file) => String(file).split("/").at(-1) === "package.json")
      .map(String);
    expect(value.graphs).toHaveLength(files.length);
    expect(value.packages).toEqual([]);
    let invalid = 0;
    for (const file of files) {
      const graph = value.graphs.find((graph) => graph.source.files.includes(file));
      expect(graph, file).toBeDefined();
      let manifest: Native;
      try {
        manifest = JSON.parse(read(id, file).replace(/^\uFEFF/, ""));
      } catch {
        invalid++;
        expect(graph).toMatchObject({
          interpretation: "unknown",
          rootCompleteness: "unknown",
          roots: [],
          nodes: [],
          edges: [],
        });
        expect(value.issues.filter((issue) => issue.file === file)).toHaveLength(1);
        expect(value.issues.find((issue) => issue.file === file)).toMatchObject({
          code: "core.file_extraction_failed",
          severity: "ERROR",
        });
        continue;
      }
      declarations(graph!, manifest, file);
      const project = value.subprojects.find((project) => project.definitionFile === file)!;
      expect(project).toBeDefined();
      expect(graph!.roots.every((root) => root.project.purl === project.purl)).toBe(true);
      if (manifest.name)
        expect(project.purl).toBe(
          `pkg:npm/${manifest.name.replace(/^@/, "%40")}${manifest.version ? `@${manifest.version}` : ""}`,
        );
      else expect(project.identityObservations?.[0]?.synthesizedPurl).toBe(true);
      for (const root of graph!.roots) {
        const closure = queryDependencies(value, { graph: graph!.id, root: root.id });
        expect(closure.definite).toEqual([]);
        expect(closure.conditional).toEqual([]);
        expect(closure.declarations).toHaveLength(Object.keys(manifest[root.scope] ?? {}).length);
        expect(closure.completeness).toBe(closure.declarations.length ? "unknown" : "complete");
      }
    }
    expect(value.subprojects).toHaveLength(files.length - invalid);
    expect(value.issues).toHaveLength(invalid);
    expect(invalid).toBe(id === "sindresorhus+boxen" ? 0 : 1);
  });
}

for (const id of [
  "ZEISS+htmx-toasts",
  "ZEISS+htmx-validate",
  "ZEISS+template-htmx-ext",
  "ZEISS+appinsights-express-middleware",
]) {
  test(`${id}: every locked placement, native declaration, binding and scope`, () => {
    const value = result(id);
    const lock = JSON.parse(read(id, "package-lock.json"));
    const manifest = JSON.parse(read(id, "package.json"));
    assertNativeNpmLock(value, lock, manifest, id);
    if (id === "ZEISS+htmx-toasts") {
      expect(value.graphs).toHaveLength(2);
      declarations(
        value.graphs.find((graph) => graph.interpretation === "declared")!,
        manifest,
        "package.json",
      );
      expect(value.subprojects.map((project) => project.purl).sort()).toEqual(
        ["pkg:npm/%40htmx/htmx-toasts@1.0.0", "pkg:npm/%40htmx/template-element@1.0.0"].sort(),
      );
      expect(value.issues.map((issue) => issue.code)).toEqual(["npm.manifest_lock_mismatch"]);
    } else {
      expect(value.graphs).toHaveLength(1);
      expect(value.issues).toEqual([]);
    }
  });
}

test("serve-handler: native Yarn descriptors and conservative manifest correlation", () => {
  const id = "vercel+serve-handler";
  const value = result(id);
  const manifest = JSON.parse(read(id, "package.json"));
  const require = createRequire(
    join(import.meta.dirname, "../packages/analyzer-plugin-javascript/package.json"),
  );
  const parsed = require("@yarnpkg/lockfile").parse(read(id, "yarn.lock"));
  expect(parsed.type).toBe("success");
  const entries = parsed.object as Record<string, Native>;
  expect(value.graphs).toHaveLength(3);
  expect(value.subprojects).toHaveLength(1);
  const project = { purl: "pkg:npm/serve-handler@6.1.6", definitionFile: "package.json" };
  expect(value.subprojects[0]).toMatchObject(project);
  declarations(
    value.graphs.find((g) => g.interpretation === "declared")!,
    manifest,
    "package.json",
  );
  expect(value.issues.map((issue) => issue.code)).toEqual(["yarn.raw_lock_projection"]);
  for (const graph of value.graphs.filter((g) => g.interpretation !== "declared")) {
    expect(graph.attributes).toMatchObject({
      "yarn:projection": "raw-descriptor-map",
      "yarn:effectiveResolution": "not-observed",
      "yarn:resolverTransformations": "not-applied",
    });
    const nodes = graph.nodes.filter((node) => !node.project);
    const descriptors = new Map(
      nodes.flatMap((node) =>
        (node.attributes!["yarn:descriptors"] as string[]).map(
          (descriptor) => [descriptor, node] as const,
        ),
      ),
    );
    expect(sorted([...descriptors.keys()])).toEqual(sorted(Object.keys(entries)));
    let expectedEdges = 0;
    for (const node of nodes) {
      const names = node.attributes!["yarn:descriptors"] as string[];
      const native = entries[names[0]!]!;
      for (const name of names) expect(entries[name]).toEqual(native);
      expect(node.attributes!["yarn:record"]).toEqual(native);
      expect(node.dependencyCompleteness).toBe("unknown");
      const name = names[0]!.slice(0, names[0]!.lastIndexOf("@"));
      expect(node.purl).toBe(`pkg:npm/${name.replace(/^@/, "%40")}@${native.version}`);
      expect(node.artifacts?.[0]?.location).toBe(native.resolved);
      expect(node.artifacts?.[0]?.attributes?.["npm:integrity"]).toBe(native.integrity);
      const outgoing = graph.edges.filter((edge) => edge.from === node.id);
      const requests = ["dependencies", "optionalDependencies"].flatMap((kind) =>
        Object.entries(native[kind] ?? {}).map(([name, specifier]) => [kind, name, specifier]),
      );
      expectedEdges += requests.length;
      expect(
        sorted(outgoing.map((e) => [e.kind, e.requested?.name, e.requested?.specifier])),
      ).toEqual(sorted(requests));
      for (const edge of outgoing) {
        const target = descriptors.get(`${edge.requested!.name}@${edge.requested!.specifier}`)!;
        expect(target).toBeDefined();
        expect(edge).toMatchObject({
          status: "resolved",
          selection: "selected",
          to: target.id,
          optional: edge.kind === "optionalDependencies",
        });
      }
    }
    expect(sorted(value.packages.map((p) => p.purl))).toEqual(
      sorted([...new Set(nodes.map((n) => n.purl))]),
    );
    if (graph.attributes!["yarn:observation"] === "native-lock") {
      expect(graph.roots).toEqual([]);
      expect(graph.rootCompleteness).toBe("unknown");
      expect(graph.edges).toHaveLength(expectedEdges);
    } else {
      expect(graph.rootCompleteness).toBe("complete");
      expect(graph.roots.map((r) => r.scope).sort()).toEqual([...scopes].sort());
      for (const node of graph.nodes.filter((n) => n.project)) {
        expect(node.project).toEqual(project);
        const root = graph.roots.find((r) => r.node === node.id);
        const kinds = root ? [root.scope] : scopes;
        const outgoing = graph.edges.filter((e) => e.from === node.id);
        const requests = kinds.flatMap((kind) =>
          Object.entries(manifest[kind] ?? {}).map(([name, specifier]) => [kind, name, specifier]),
        );
        expectedEdges += requests.length;
        expect(
          sorted(outgoing.map((e) => [e.kind, e.requested?.name, e.requested?.specifier])),
        ).toEqual(sorted(requests));
        for (const edge of outgoing) {
          const target = descriptors.get(`${edge.requested!.name}@${edge.requested!.specifier}`)!;
          expect(target).toBeDefined();
          expect(edge).toMatchObject({
            status: "resolved",
            to: target.id,
            selection: !root && edge.kind === "devDependencies" ? "excluded" : "unknown",
          });
        }
      }
      expect(graph.edges).toHaveLength(expectedEdges);
      for (const root of graph.roots) {
        const closure = queryDependencies(value, { graph: graph.id, root: root.id });
        expect(closure.definite).toEqual([]);
        expect(closure.completeness).toBe(
          Object.keys(manifest[root.scope] ?? {}).length ? "unknown" : "complete",
        );
      }
    }
  }
});
