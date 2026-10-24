import { expect } from "vite-plus/test";
import { queryDependencies, type AnalyzerResult } from "@scatool/analyzer-core";
type Native = Record<string, any>;
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const sorted = <T>(values: T[]) =>
  values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function recordsFromLock(lock: Native): Record<string, Native> {
  if (lock.lockfileVersion !== 1) return lock.packages;
  const output: Record<string, Native> = {};
  function visit(records: Native, prefix: string) {
    for (const [name, record] of Object.entries(records) as [string, Native][]) {
      const location = `${prefix}node_modules/${name}`;
      output[location] = { ...record, dependencies: record.requires ?? {} };
      if (record.dependencies) visit(record.dependencies, `${location}/`);
    }
  }
  visit(lock.dependencies, "");
  return output;
}

// Independent nearest ancestor placement lookup over the input table (no converter helper).
function findPlacement(records: Record<string, Native>, location: string, name: string) {
  const parts = location.split("/").filter(Boolean);
  for (let count = parts.length; count >= 0; count--) {
    const prefix = parts.slice(0, count);
    if (prefix.at(-1) === "node_modules") continue;
    const path = [...prefix, "node_modules", name].join("/");
    if (Object.hasOwn(records, path)) return path;
  }
  return undefined;
}

/** Compare placement and request semantics directly with native lock records. These acceptance inputs contain no workspace links. */
export function assertNativeNpmLock(
  value: AnalyzerResult,
  lock: Native,
  manifest: Native,
  id: string,
  definitionFile = "package.json",
) {
  const records = recordsFromLock(lock);
  const graph = value.graphs.find((graph) => graph.interpretation === "locked")!;
  expect(graph).toBeDefined();
  const placements = Object.keys(records).filter((key) => key.includes("node_modules"));
  expect(placements.every((key) => records[key]!.link !== true)).toBe(true);
  const nodes = graph.nodes.filter((node) => !node.project);
  expect(sorted(nodes.map((node) => node.locator))).toEqual(sorted(placements));
  const rootManifest = lock.lockfileVersion === 1 ? manifest : records[""]!;
  expect(graph.rootCompleteness).toBe("complete");
  const project = {
    purl: `pkg:npm/${(rootManifest.name ?? lock.name).replace(/^@/, "%40")}${(rootManifest.version ?? lock.version) ? `@${rootManifest.version ?? lock.version}` : ""}`,
    definitionFile,
  };
  expect(value.subprojects).toContainEqual(expect.objectContaining(project));
  for (const root of graph.roots) expect(root.project).toEqual(project);
  for (const node of graph.nodes.filter((node) => node.project))
    expect(node.project).toEqual(project);
  expect(graph.roots.map((root) => root.scope).sort()).toEqual([...scopes].sort());
  expect(graph.nodes).toHaveLength(placements.length + 5);
  const observedRequests: unknown[] = [];
  const expectedRequests: unknown[] = [];
  for (const node of graph.nodes) {
    const root = graph.roots.find((root) => root.node === node.id);
    const location = node.project ? "" : node.locator!;
    const native = node.project ? rootManifest : records[location]!;
    expect(native).toBeDefined();
    if (!node.project) {
      expect(node.dependencyCompleteness).toBe("complete");
      const nativeName = native.name ?? location.split("node_modules/").at(-1)!;
      expect(node.purl).toBe(`pkg:npm/${nativeName.replace(/^@/, "%40")}@${native.version}`);
      const artifact = node.artifacts?.[0];
      if (native.resolved) expect(artifact?.location).toBe(native.resolved);
      if (native.integrity) expect(artifact?.attributes?.["npm:integrity"]).toBe(native.integrity);
      expect(value.packages.some((pkg) => pkg.purl === node.purl)).toBe(true);
      expect(node.attributes?.["npm:metadata"]).toMatchObject(
        lock.lockfileVersion === 1
          ? { version: native.version, dependencies: native.dependencies }
          : native,
      );
    }
    const nativeScopes = root ? [root.scope] : scopes;
    const outgoing = graph.edges.filter((edge) => edge.from === node.id);
    for (const scope of nativeScopes) {
      for (const [name, specifier] of Object.entries(native[scope] ?? {})) {
        expectedRequests.push([node.id, scope, name, specifier]);
        const edge = outgoing.find((edge) => edge.kind === scope && edge.requested?.name === name);
        expect(edge, `${id}:${location}/${scope}/${name}`).toBeDefined();
        expect(edge!.requested?.specifier).toBe(specifier);
        const target = findPlacement(records, location, name);
        if (target) {
          expect(edge!.status).toBe("resolved");
          if (edge!.status === "resolved")
            expect(graph.nodes.find((node) => node.id === edge!.to)?.locator).toBe(target);
        } else {
          expect(edge).not.toHaveProperty("to");
          expect(edge!.status).toBe("declared");
        }
        const optional =
          scope === "optionalDependencies" ||
          (scope === "peerDependencies" && native.peerDependenciesMeta?.[name]?.optional === true);
        expect(edge!.optional).toBe(optional);
        const excluded =
          (scope === "devDependencies" && !root) ||
          (scope === "dependencies" && Object.hasOwn(native.optionalDependencies ?? {}, name)) ||
          (scope === "peerDependencies" && optional && !target);
        const platform = target
          ? Object.fromEntries(
              ["os", "cpu", "libc"]
                .filter((key) => records[target]![key] !== undefined)
                .map((key) => [key, records[target]![key]]),
            )
          : {};
        const unknown =
          scope === "peerDependencies" ||
          (optional && !target) ||
          (lock.lockfileVersion === 1 && node.project);
        expect(edge!.selection).toBe(
          excluded
            ? "excluded"
            : unknown
              ? "unknown"
              : Object.keys(platform).length
                ? "conditional"
                : "selected",
        );
        if (!excluded && Object.keys(platform).length)
          expect(edge!.condition).toEqual({ language: "npm:platform/v1", expression: platform });
        else expect(edge).not.toHaveProperty("condition");
      }
    }
    for (const edge of outgoing)
      observedRequests.push([
        edge.from,
        edge.kind,
        edge.requested?.name,
        edge.requested?.specifier,
      ]);
  }
  expect(sorted(observedRequests)).toEqual(sorted(expectedRequests));
  expect(graph.edges).toHaveLength(expectedRequests.length);
  expect(sorted(value.packages.map((pkg) => pkg.purl))).toEqual(
    sorted([...new Set(nodes.map((node) => node.purl))]),
  );
  if (lock.lockfileVersion === 1)
    for (const root of graph.roots) {
      const closure = queryDependencies(value, { graph: graph.id, root: root.id });
      expect(closure.definite).toEqual([]);
      expect(closure.completeness).toBe(
        Object.keys(rootManifest[root.scope] ?? {}).length ? "partial" : "complete",
      );
    }
  return graph;
}
