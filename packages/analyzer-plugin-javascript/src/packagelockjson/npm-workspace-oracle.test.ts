import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";
const directory = join(import.meta.dirname, "__fixtures__/npm-workspace-oracle");
type NativeEdge = {
  from: string;
  name: string;
  spec: string;
  type: string;
  error: string | null;
  to: string | null;
  target: string | null;
};
type NativeTree = {
  nodes: {
    location: string;
    name: string;
    packageName?: string;
    version: string;
    link: boolean;
    target: string | null;
  }[];
  edges: NativeEdge[];
};
const report = JSON.parse(await readFile(join(directory, "native-observations.json"), "utf8")) as {
  tools: Record<string, string>;
  cases: {
    id: string;
    lockfileVersion: number;
    mode: string;
    inputSha256: Record<string, string>;
    installedBeforeMutation: NativeTree;
    virtual: NativeTree;
    virtualError?: unknown;
  }[];
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
test("native workspace matrix contains every version and manifest state", () => {
  expect(report.cases.map((item) => item.id).sort(compare)).toEqual(
    [1, 2, 3]
      .flatMap((version) => ["current", "missing", "stale"].map((mode) => `v${version}-${mode}`))
      .sort(compare),
  );
});
for (const item of report.cases)
  test(`${item.id}: native workspace/link/alias source contract`, async () => {
    expect(report.tools).toEqual({
      node: "v22.23.4",
      npm: "11.9.0",
      arborist: "9.2.0",
      oxfmt: "0.73.0",
    });
    for (const [path, hash] of Object.entries(item.inputSha256))
      expect(
        createHash("sha256")
          .update(await readFile(join(directory, item.id, path)))
          .digest("hex"),
      ).toBe(hash);
    expect(item.virtualError).toBeUndefined();
    for (const tree of [item.installedBeforeMutation, item.virtual]) {
      expect(tree.nodes).toHaveLength(8);
      expect(tree.nodes.find((n) => n.location === "node_modules/renamed")).toMatchObject({
        name: "renamed",
        packageName: "real-leaf",
        version: "1.0.0",
        link: false,
      });
      for (const [name, target] of [
        ["workspace-app", "apps/app"],
        ["workspace-lib", "packages/lib"],
        ["local-link", "local"],
      ])
        expect(tree.nodes.find((n) => n.location === `node_modules/${name}`)).toMatchObject({
          link: true,
          target,
        });
      expect(tree.edges.every((e) => e.error === null)).toBe(true);
    }
    const appEdges = item.virtual.edges.filter((e) => e.from === "apps/app");
    expect(appEdges.map((e) => e.name).sort(compare)).toEqual(
      item.mode === "stale" ? ["workspace-lib"] : ["renamed", "workspace-lib"],
    );
    expect(item.virtual.edges.some((e) => e.from === "" && e.name === "workspace-app")).toBe(
      item.mode !== "missing",
    );
    const result = await extractorV2.extract(join(directory, item.id), undefined, {
      codebaseId: `oracle:${item.id}`,
    });
    validateResultV2(result);
    const graph = result.graphs.find((g) => g.interpretation === "locked")!;
    expect(graph.nodes.find((n) => n.locator === "node_modules/renamed")?.purl).toBe(
      "pkg:npm/real-leaf@1.0.0",
    );
    if (item.lockfileVersion === 1) {
      // v1 file: targets lack independently recorded project scopes; enumeration cannot be complete.
      expect(graph.rootCompleteness).toBe("unknown");
      expect(result.issues.map((issue) => [issue.code, issue.severity, issue.file])).toEqual([
        ["npm.legacy_local_context_unknown", "WARNING", "package-lock.json"],
      ]);
      expect(
        graph.nodes.find((node) => node.locator === "node_modules/renamed")?.dependencyCompleteness,
      ).toBe("complete");
      const lock = JSON.parse(
        await readFile(join(directory, item.id, "package-lock.json"), "utf8"),
      ) as { dependencies: Record<string, { requires?: Record<string, string> }> };
      for (const name of ["local-link", "workspace-app", "workspace-lib"]) {
        const node = graph.nodes.find((value) => value.locator === `node_modules/${name}`)!;
        expect(node.dependencyCompleteness).toBe("unknown");
        const edges = graph.edges.filter((edge) => edge.from === node.id);
        expect(
          edges.map((edge) => `${edge.requested?.name}:${edge.requested?.specifier}`).sort(compare),
        ).toEqual(
          Object.entries(lock.dependencies[name]!.requires ?? {})
            .map(([dependency, spec]) => `${dependency}:${spec}`)
            .sort(compare),
        );
        for (const edge of edges) {
          expect(edge.selection).toBe("unknown");
          const candidate = graph.nodes.find((value) => value.id === edge.to)!;
          expect(candidate.locator).toBe(`node_modules/${edge.requested!.name}`);
        }
      }
      return;
    }
    expect(graph.rootCompleteness).toBe("complete");
    const appDefinition =
      item.mode === "missing" ? "package-lock.json#packages/apps%2Fapp" : "apps/app/package.json";
    const definitions = new Map([
      ["", "package.json"],
      ["apps/app", appDefinition],
      ["packages/lib", "packages/lib/package.json"],
      ["local", "local/package.json"],
    ]);
    expect(graph.roots.map((r) => `${r.project.definitionFile}:${r.scope}`).sort(compare)).toEqual(
      [...definitions.values()]
        .flatMap((path) =>
          ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].map(
            (scope) => `${path}:${scope}`,
          ),
        )
        .sort(compare),
    );
    for (const [location, definition] of definitions) {
      const root = graph.roots.find(
        (r) => r.project.definitionFile === definition && r.scope === "dependencies",
      )!;
      const outgoing = graph.edges.filter((e) => e.from === root.node);
      // Compare the pre-mutation native installation, whose source matches the frozen lock.
      const native = item.installedBeforeMutation.edges.filter(
        (e) => e.from === location && e.type !== "workspace",
      );
      expect(
        outgoing.map((e) => `${e.requested?.name}:${e.requested?.specifier}`).sort(compare),
      ).toEqual(native.map((e) => `${e.name}:${e.spec}`).sort(compare));
      for (const edge of outgoing) {
        const expected = native.find((e) => e.name === edge.requested?.name)!;
        expect(edge.status).toBe("resolved");
        expect(edge.selection).toBe("selected");
        const target = graph.nodes.find((n) => n.id === edge.to)!;
        expect(target.locator).toBe(expected.target ?? expected.to);
      }
    }
    if (item.mode === "stale") {
      expect(
        result.issues.filter((i) => i.code === "npm.manifest_lock_mismatch").map((i) => i.file),
      ).toEqual(["apps/app/package.json"]);
      const declared = result.graphs.find((g) => g.interpretation === "declared")!;
      const root = declared.roots.find((r) => r.scope === "dependencies")!;
      expect(
        declared.edges.filter((e) => e.from === root.node).map((e) => e.requested?.name),
      ).toEqual(["workspace-lib"]);
    } else expect(result.issues).toEqual([]);
  });
