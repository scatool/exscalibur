import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, dirname } from "node:path/posix";
import { expect, test } from "vite-plus/test";
import { parse as toml } from "smol-toml";
import { parseResult, type DependencyGraph } from "@scatool/analyzer-core";
import {
  checkDeclarations,
  checkYarn,
  checkNpm,
  checkPnpm,
  checkNativeFacts,
} from "./acceptance/native-workspace-javascript.ts";
// Preserve default JavaScript lexicographic ordering for native scalar tuples.
function sortText(value: unknown): string {
  if (Array.isArray(value)) return value.map(sortText).join(",");
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new TypeError("Expected a scalar or tuple sort key");
}
function compareNative(a: unknown, b: unknown): number {
  const left = sortText(a),
    right = sortText(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function nativeString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a native string");
  return value;
}
type Data = Record<string, any>;
const require = createRequire(
  new URL("../packages/analyzer-plugin-javascript/package.json", import.meta.url),
);
const { PackageURL } = require("packageurl-js") as {
  PackageURL: { fromString: (p: string) => { name: string; namespace?: string; version?: string } };
};
const jsonc = require("jsonc-parser") as { parse: (text: string) => Data };
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const evidence = JSON.parse(read("acceptance/mixed-workspace-sources.json")) as Record<
  string,
  Data
>;
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const paths = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? paths(join(directory, e.name)) : [join(directory, e.name)],
  );
const tuples = (graph: DependencyGraph, id: string) =>
  graph.edges
    .filter((e) => e.from === id)
    .map((e) => [e.kind, e.requested?.name, e.requested?.specifier])
    .sort(compareNative);
function cargo(graph: DependencyGraph, source: (path: string) => string) {
  const native = toml(source(graph.source.files[0]!)) as Data;
  expect(graph.attributes?.["cargo:document"]).toEqual(native);
  expect(graph.rootCompleteness).toBe("unknown");
  expect(graph.roots).toEqual([]);
  expect(graph.nodes).toHaveLength(native.package.length);
  for (const pkg of native.package) {
    const node =
      graph.nodes.find(
        (n) => JSON.stringify(n.attributes?.["cargo:lockPackage"]) === JSON.stringify(pkg),
      ) ??
      graph.nodes.find((n) => {
        const p = n.attributes?.["cargo:lockPackage"] as Data;
        return p.name === pkg.name && p.version === pkg.version && p.source === pkg.source;
      });
    expect(node).toBeDefined();
    expect(node!.attributes?.["cargo:lockPackage"]).toEqual(pkg);
    expect(node!.project).toBeUndefined();
    if (pkg.source) {
      expect(pkg.source).toBe("registry+https://github.com/rust-lang/crates.io-index");
      expect(node!.purl).toBe(`pkg:cargo/${pkg.name}@${pkg.version}`);
    } else {
      expect(node!.purl.startsWith(`pkg:generic/cargo-local/${pkg.name}-`)).toBe(true);
      expect(node!.purl.endsWith(`@${pkg.version}`)).toBe(true);
    }
    if (pkg.checksum)
      expect(node!.artifacts).toEqual([
        { evidence: [graph.source.files[0]], hashes: { sha256: pkg.checksum } },
      ]);
    expect(node!.dependencyCompleteness).toBe("complete");
    const edges = graph.edges.filter((e) => e.from === node!.id);
    expect(
      edges.map((e) => e.requested?.attributes?.["cargo:lockReference"]).sort(compareNative),
    ).toEqual([...(pkg.dependencies ?? [])].sort(compareNative));
    for (const edge of edges) {
      const ref = nativeString(edge.requested?.attributes?.["cargo:lockReference"]);
      const [name, version] = ref.split(" ");
      const target = graph.nodes.find((n) => {
        const p = n.attributes?.["cargo:lockPackage"] as Data;
        return p.name === name && (!version || p.version === version);
      });
      expect(target).toBeDefined();
      expect(edge.to).toBe(target!.id);
      expect(edge.status).toBe("resolved");
      expect(edge.selection).toBe("selected");
    }
  }
}
function bun(graph: DependencyGraph, source: (path: string) => string) {
  const file = graph.source.files.find((p) => p.endsWith("bun.lock"));
  if (!file) {
    expect(graph.rootCompleteness).toBe("unknown");
    expect(graph.interpretation).toBe("unknown");
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.roots).toEqual([]);
    return;
  }
  const native = jsonc.parse(source(file));
  const nodes = graph.nodes.filter((n) => n.attributes?.["bun:tuple"] !== undefined);
  expect(nodes).toHaveLength(Object.keys(native.packages).length);
  for (const [key, tuple] of Object.entries(native.packages) as [string, any[]][]) {
    const node = nodes.find((n) => n.locator === key)!;
    expect(node).toBeDefined();
    expect(node.attributes?.["bun:tuple"]).toEqual(tuple);
    const info = (
      typeof tuple[2] === "object" ? tuple[2] : typeof tuple[1] === "object" ? tuple[1] : {}
    ) as Data;
    if (node.project) continue;
    const at = String(tuple[0]).indexOf(
      "@",
      String(tuple[0]).startsWith("@") ? String(tuple[0]).indexOf("/") + 1 : 0,
    );
    const name = String(tuple[0]).slice(0, at),
      version = String(tuple[0]).slice(at + 1);
    const identity = PackageURL.fromString(node.purl);
    expect(identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name).toBe(
      name.toLowerCase(),
    );
    if (/^\d+\.\d+\./.test(version)) {
      expect(identity.version).toBe(version);
      if (tuple[3])
        expect(node.artifacts?.some((a) => a.attributes?.["npm:integrity"] === tuple[3])).toBe(
          true,
        );
    } else {
      expect(version.startsWith("https://")).toBe(true);
      expect(node.artifacts?.some((a) => a.location === version)).toBe(true);
    }
    for (const condition of ["os", "cpu", "libc"])
      if (info[condition])
        expect(
          node.attributes?.["npm:metadata"] && (node.attributes["npm:metadata"] as Data)[condition],
        ).toEqual(info[condition]);
    const expected = scopes
      .filter((s) => s !== "devDependencies")
      .flatMap((s) => Object.entries(info[s] ?? {}).map(([name, spec]) => [s, name, spec]))
      .sort(compareNative);
    expect(tuples(graph, node.id)).toEqual(expected);
    for (const edge of graph.edges.filter((e) => e.from === node.id)) {
      if (edge.kind === "peerDependencies") expect(edge.selection).toBe("unknown");
      // Enumerate ancestor placements without a resolver helper.
      const segments = key.match(/(?:@[^/]+\/)?[^/]+/g) ?? [];
      const candidates = Array.from({ length: segments.length + 1 }, (_, i) =>
        segments.slice(0, segments.length - i).join("/"),
      );
      const target = candidates
        .map((p) => nodes.find((n) => n.locator === (p ? p + "/" : "") + edge.requested?.name))
        .find(Boolean);
      if (target) {
        expect(edge.to).toBe(target.id);
        expect(edge.status).toBe("resolved");
      } else expect(edge.status).not.toBe("resolved");
    }
  }
  expect(graph.roots.map((r) => [r.project.definitionFile, r.scope]).sort(compareNative)).toEqual(
    Object.keys(native.workspaces)
      .flatMap((p) => scopes.map((s) => [join(dirname(file), p, "package.json"), s]))
      .sort(compareNative),
  );
  for (const node of graph.nodes.filter(
    (n) => n.project && !graph.roots.some((r) => r.node === n.id),
  )) {
    const location = Object.keys(native.workspaces).find(
      (p) => join(dirname(file), p, "package.json") === node.project!.definitionFile,
    )!;
    expect(location).toBeDefined();
    const metadata = native.workspaces[location];
    expect(tuples(graph, node.id)).toEqual(
      scopes
        .flatMap((scope) =>
          Object.entries(metadata[scope] ?? {}).map(([name, spec]) => [scope, name, spec]),
        )
        .sort(compareNative),
    );
    const aliases = Object.entries(native.packages).filter(
      ([, tuple]) => (tuple as any[])[0] === `${metadata.name}@workspace:${location}`,
    );
    const caller = node.attributes?.["bun:tuple"]
      ? node.locator!
      : !location || location === "."
        ? ""
        : (aliases.find(([key]) => key === metadata.name)?.[0] ??
          aliases.find(([key]) => key.startsWith("./"))?.[0] ??
          `./${metadata.name}`);
    const segments = caller.match(/(?:@[^/]+\/)?[^/]+/g) ?? [];
    for (const edge of graph.edges.filter((e) => e.from === node.id)) {
      const candidate = Array.from({ length: segments.length + 1 }, (_, i) =>
        segments.slice(0, segments.length - i).join("/"),
      )
        .map((prefix) =>
          nodes.find((n) => n.locator === (prefix ? prefix + "/" : "") + edge.requested?.name),
        )
        .find(Boolean);
      if (candidate) expect(edge.to).toBe(candidate.id);
      else expect(edge.status).not.toBe("resolved");
      if (edge.kind === "devDependencies") expect(edge.selection).toBe("excluded");
      else if (edge.kind === "peerDependencies") expect(edge.selection).toBe("unknown");
    }
  }
  // Native target applicability is independent of the serialized edge condition.
  for (const edge of graph.edges) {
    const target = graph.nodes.find((node) => node.id === edge.to);
    const tuple = target?.locator ? native.packages[target.locator] : undefined;
    const metadata = tuple
      ? typeof tuple[2] === "object"
        ? tuple[2]
        : typeof tuple[1] === "object"
          ? tuple[1]
          : {}
      : {};
    const platform = Object.fromEntries(
      ["os", "cpu", "libc"]
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, metadata[key]]),
    );
    const condition = Object.keys(platform).length
      ? { language: "npm:platform/v1", expression: platform }
      : undefined;
    expect(edge.condition).toEqual(edge.selection === "excluded" ? undefined : condition);
    if (edge.kind === "peerDependencies") expect(edge.selection).toBe("unknown");
    else if (edge.status === "resolved" && edge.selection !== "excluded")
      expect(edge.selection).toBe(condition ? "conditional" : "selected");
  }
  for (const root of graph.roots) {
    const location = Object.keys(native.workspaces).find(
      (p) => join(dirname(file), p, "package.json") === root.project.definitionFile,
    )!;
    expect(tuples(graph, root.node)).toEqual(
      Object.entries(native.workspaces[location][root.scope] ?? {})
        .map(([name, spec]) => [root.scope, name, spec])
        .sort(compareNative),
    );
    const identity = PackageURL.fromString(root.project.purl);
    const meta = native.workspaces[location];
    expect(identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name).toBe(
      meta.name.toLowerCase(),
    );
    if (meta.version) expect(identity.version).toBe(meta.version);
    for (const edge of graph.edges.filter((e) => e.from === root.node)) {
      if (root.scope === "peerDependencies") expect(edge.selection).toBe("unknown");
      else expect(edge.selection).toBe(edge.condition ? "conditional" : "selected");
    }
  }
}
for (const [id, entry] of Object.entries(evidence))
  test(`${id}: pinned native inventory and graph semantics`, () => {
    const result = parseResult(JSON.parse(read(`__snapshots__/${id}.json`)));
    const source = (path: string) => read(`repositories/${id}/${path}`);
    const root = join(import.meta.dirname, "repositories", id);
    const matched = paths(root)
      .map((p) => p.slice(root.length + 1))
      .filter((p) =>
        /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.(?:lock|toml)|go\.mod|build\.gradle(?:\.kts)?|Pipfile\.lock|poetry\.lock|pdm\.lock|pyproject\.toml|conanfile\.(?:py|txt)|vcpkg\.json|requirements[^/]*\.txt)$/.test(
          p,
        ),
      )
      .sort(compareNative);
    expect(matched).toEqual(
      Object.keys(entry.inputs)
        .filter((p) => p !== ".gitmodules")
        .sort(compareNative),
    );
    for (const path of Object.keys(entry.inputs))
      expect(
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      ).toBe(entry.inputs[path]);
    expect(
      result.graphs.map((g) => ({
        source: g.source,
        interpretation: g.interpretation,
        rootCompleteness: g.rootCompleteness,
      })),
    ).toEqual(entry.graphSources);
    expect(result.issues.map((i) => [i.code, i.severity, i.file]).sort(compareNative)).toEqual(
      entry.issues,
    );
    expect(
      result.graphs.reduce(
        (r, g) => ((r[g.source.extractor] = (r[g.source.extractor] ?? 0) + 1), r),
        {} as Record<string, number>,
      ),
    ).toEqual(entry.graphs);
    expect({
      packages: result.packages.length,
      subprojects: result.subprojects.length,
      graphs: result.graphs.length,
      nodes: result.graphs.reduce((n, g) => n + g.nodes.length, 0),
      roots: result.graphs.reduce((n, g) => n + g.roots.length, 0),
      edges: result.graphs.reduce((n, g) => n + g.edges.length, 0),
    }).toEqual(entry.counts);
    for (const graph of result.graphs.filter(
      (g) => g.attributes?.["yarn:observation"] === "current-manifest-scopes",
    )) {
      const files = graph.source.files.filter((f) => f.endsWith("package.json"));
      expect(
        graph.roots.map((r) => [r.project.definitionFile, r.scope]).sort(compareNative),
      ).toEqual(files.flatMap((f) => scopes.map((scope) => [f, scope])).sort(compareNative));
      for (const root of graph.roots) {
        const manifest = JSON.parse(source(root.project.definitionFile));
        expect(tuples(graph, root.node)).toEqual(
          Object.entries(manifest[root.scope] ?? {})
            .map(([name, spec]) => [root.scope, name, spec])
            .sort(compareNative),
        );
        for (const edge of graph.edges.filter(
          (e) => e.from === root.node && e.kind === "peerDependencies",
        ))
          expect(edge.selection).toBe("unknown");
      }
    }
    for (const graph of result.graphs) {
      if (["packagelockjson", "pnpmlock", "yarnberry", "yarnlock"].includes(graph.source.extractor))
        checkNativeFacts(graph, source);
      if (graph.interpretation === "declared") checkDeclarations(graph, source);
      else if (graph.source.extractor === "packagelockjson") checkNpm(graph, source);
      else if (graph.source.extractor === "pnpmlock") checkPnpm(graph, source);
      else if (graph.source.extractor.startsWith("yarn")) checkYarn(graph, source);
      else if (graph.source.extractor === "cargolock") cargo(graph, source);
      else if (graph.source.extractor === "bunlock") bun(graph, source);
      else throw new Error("Unreviewed graph");
    }
  }, 30_000);
