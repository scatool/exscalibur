import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import {
  queryDependenciesV2,
  validateResultV2,
  type AnalyzerResultV2,
} from "@scatool/analyzer-core";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { extractorV2 } from "./index-v2.ts";

async function input(
  lock: Record<string, unknown>,
  manifests: Record<string, Record<string, unknown>>,
  run: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-pnpm-v2-"));
  try {
    await writeFile(join(directory, "pnpm-lock.yaml"), stringify(lock));
    for (const [file, manifest] of Object.entries(manifests)) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await writeFile(join(directory, file), JSON.stringify(manifest));
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const extract = (directory: string) =>
  extractorV2.extract(directory, undefined, { codebaseId: "example:pnpm" });
function reached(result: AnalyzerResultV2, file = "package.json", scope = "dependencies") {
  const graph = result.graphs.find((graph) => graph.source.extractor === "pnpmlock")!;
  const root = graph.roots.find(
    (root) => root.project.definitionFile === file && root.scope === scope,
  )!;
  const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
  const purls = [
    ...new Set(
      [...closure.definite, ...closure.conditional].map(
        (id) => graph.nodes.find((node) => node.id === id)!.purl,
      ),
    ),
  ].sort((a, b) => String(a).localeCompare(String(b)));
  return { ...closure, graph, root, purls };
}

test("v9 snapshot references preserve peer contexts inside one project and scope", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: {
        ".": {
          dependencies: { left: { specifier: "1", version: "1.0.0" } },
          devDependencies: { right: { specifier: "1", version: "1.0.0" } },
        },
      },
      packages: {
        "left@1.0.0": {},
        "right@1.0.0": {},
        "widget@1.0.0": { peerDependencies: { react: ">=18" } },
        "react@18.3.1": {},
        "react@19.0.0": {},
      },
      snapshots: {
        "left@1.0.0": { dependencies: { widget: "1.0.0(react@18.3.1)" } },
        "right@1.0.0": { dependencies: { widget: "1.0.0(react@19.0.0)" } },
        "widget@1.0.0(react@18.3.1)": {
          dependencies: { react: "18.3.1" },
          transitivePeerDependencies: ["host"],
        },
        "widget@1.0.0(react@19.0.0)": { dependencies: { react: "19.0.0" } },
        "react@18.3.1": {},
        "react@19.0.0": {},
      },
    },
    {
      "package.json": {
        name: "app",
        version: "1.0.0",
        dependencies: { left: "1" },
        devDependencies: { right: "1" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      expect(reached(result).purls).toEqual([
        "pkg:npm/left@1.0.0",
        "pkg:npm/react@18.3.1",
        "pkg:npm/widget@1.0.0",
      ]);
      expect(reached(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/react@19.0.0",
        "pkg:npm/right@1.0.0",
        "pkg:npm/widget@1.0.0",
      ]);
      const widgets = reached(result).graph.nodes.filter(
        (node) => node.purl === "pkg:npm/widget@1.0.0",
      );
      expect(widgets).toHaveLength(2);
      expect(widgets.some((node) => node.locator === "widget@1.0.0(react@18.3.1)")).toBe(true);
      expect(
        reached(result).graph.edges.some(
          (edge) => edge.kind === "peerDependencies" && edge.selection === "selected",
        ),
      ).toBe(true);
      expect(
        widgets.find((node) => node.locator?.includes("18.3.1"))!.attributes?.["pnpm:snapshot"],
      ).toMatchObject({ transitivePeerDependencies: ["host"] });
    },
  );
});

test("workspace links resolve relative to their importer and exclude consumed project development roots", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: {
        ".": { dependencies: { ui: { specifier: "workspace:*", version: "link:packages/ui" } } },
        "packages/ui": {
          dependencies: { react: { specifier: "^18", version: "18.3.1" } },
          devDependencies: { test: { specifier: "1", version: "1.0.0" } },
        },
      },
      packages: { "react@18.3.1": {}, "test@1.0.0": {} },
      snapshots: { "react@18.3.1": {}, "test@1.0.0": {} },
    },
    {
      "package.json": { name: "app", version: "1.0.0", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": {
        name: "ui",
        version: "1.0.0",
        dependencies: { react: "^18" },
        devDependencies: { test: "1" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual(["pkg:npm/react@18.3.1", "pkg:npm/ui@1.0.0"]);
      expect(reached(result, "packages/ui/package.json", "devDependencies").purls).toEqual([
        "pkg:npm/test@1.0.0",
      ]);
    },
  );
});

test("legacy slash-format package keys preserve peer suffixes for topology and decode actual identities", async () => {
  await input(
    {
      lockfileVersion: 5.4,
      specifiers: { alias: "npm:@scope/widget@1" },
      dependencies: { alias: "/@scope/widget/1.0.0_react@18.3.1" },
      packages: {
        "/@scope/widget/1.0.0_react@18.3.1": {
          peerDependencies: { react: "^18" },
          dependencies: { react: "18.3.1" },
        },
        "/react/18.3.1": {},
      },
    },
    {
      "package.json": {
        name: "app",
        version: "1.0.0",
        dependencies: { alias: "npm:@scope/widget@1" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      expect(reached(result).purls).toEqual([
        "pkg:npm/%40scope/widget@1.0.0",
        "pkg:npm/react@18.3.1",
      ]);
      expect(
        reached(result).graph.nodes.some(
          (node) => node.locator === "/@scope/widget/1.0.0_react@18.3.1",
        ),
      ).toBe(true);
    },
  );
});

test("missing exact peer snapshots keep unknown adjacency instead of choosing another peer variant", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { widget: { specifier: "1", version: "1.0.0" } } } },
      packages: { "widget@1.0.0": {}, "react@18.3.1": {} },
      snapshots: {
        "widget@1.0.0(react@18.3.1)": { dependencies: { react: "18.3.1" } },
        "react@18.3.1": {},
      },
    },
    { "package.json": { name: "app", version: "1.0.0", dependencies: { widget: "1" } } },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual(["pkg:npm/widget@1.0.0"]);
      expect(reached(result).completeness).toBe("unknown");
    },
  );
});

test("native locked requests and current manifest declarations remain independent observations", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { foo: { specifier: "^1", version: "1.0.0" } } } },
      packages: { "foo@1.0.0": {} },
      snapshots: { "foo@1.0.0": {} },
    },
    {
      "package.json": {
        name: "app",
        version: "1.0.0",
        dependencies: { foo: "^2" },
        peerDependencies: { host: "^3" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual(["pkg:npm/foo@1.0.0"]);
      const graph = result.graphs.find((graph) => graph.interpretation === "declared")!;
      const root = graph.roots.find((root) => root.scope === "dependencies")!;
      const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
      expect(closure.definite).toEqual([]);
      expect(closure.declarations[0]!.dependency.requested.specifier).toBe("^2");
      expect(graph.roots.some((root) => root.scope === "peerDependencies")).toBe(true);
    },
  );
});

test("all native pnpm fixture inputs preserve graph references and mandatory identities", async () => {
  const directory = join(import.meta.dirname, "__fixtures__");
  for (const name of await scanFixtures(directory, "*/pnpm-lock.yaml")) {
    const result = await extract(join(directory, name));
    expect(
      result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
      name,
    ).toEqual([]);
    validateResultV2(result);
    expect(result.packages.length, name).toBeGreaterThan(0);
    expect(result.subprojects.length, name).toBeGreaterThan(0);
  }
});

test("legacy alternative registries and opaque paths use native coordinates rather than path segments", async () => {
  await input(
    {
      lockfileVersion: 5.4,
      specifiers: { foo: "1", widget: "1", git: "github:example/repo", dotted: "1" },
      dependencies: {
        foo: "registry.example.com/foo/1.0.0",
        widget: "registry.example.com/@scope/widget/1.0.0",
        git: "example-opaque-git-locator",
        dotted: "/dotted.name/1.0.0",
      },
      packages: {
        "registry.example.com/foo/1.0.0": {},
        "registry.example.com/@scope/widget/1.0.0": {},
        "example-opaque-git-locator": {
          name: "git-package",
          version: "3.0.0",
          resolution: { repo: "https://github.com/example/repo.git", commit: "abcdef" },
        },
        "/dotted.name/1.0.0": {},
      },
    },
    { "package.json": { name: "app", version: "1.0.0" } },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      expect(reached(result).purls).toEqual([
        "pkg:npm/%40scope/widget@1.0.0",
        "pkg:npm/dotted.name@1.0.0",
        "pkg:npm/foo@1.0.0",
        "pkg:npm/git-package@3.0.0",
      ]);
      expect(
        reached(result).graph.nodes.some(
          (node) => node.locator === "registry.example.com/foo/1.0.0",
        ),
      ).toBe(true);
    },
  );
});

test("unreported original importer requirements stay absent and native peer names cannot access prototypes", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { widget: { version: "1.0.0(constructor@2.0.0)" } } } },
      packages: {
        "widget@1.0.0": { peerDependencies: { constructor: "^2" } },
        "constructor@2.0.0": {},
      },
      snapshots: {
        "widget@1.0.0(constructor@2.0.0)": { dependencies: { constructor: "2.0.0" } },
        "constructor@2.0.0": {},
      },
    },
    { "package.json": { name: "app", version: "1.0.0" } },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      const closure = reached(result);
      expect(closure.purls).toEqual(["pkg:npm/constructor@2.0.0", "pkg:npm/widget@1.0.0"]);
      const binding = closure.graph.edges.find((edge) => edge.from === closure.root.node)!;
      expect(binding.requested).toEqual({ name: "widget" });
      expect(binding.attributes).toEqual({
        "pnpm:dependencyReference": "1.0.0(constructor@2.0.0)",
      });
    },
  );
});

test("pnpm workspace platform restrictions apply to linked consumers and descendants", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: {
        ".": { dependencies: { ui: { specifier: "workspace:*", version: "link:packages/ui" } } },
        "packages/ui": { dependencies: { foo: { specifier: "1", version: "1.0.0" } } },
      },
      packages: { "foo@1.0.0": {} },
      snapshots: { "foo@1.0.0": {} },
    },
    {
      "package.json": { name: "app", version: "1.0.0", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": {
        name: "ui",
        version: "1.0.0",
        os: ["win32"],
        dependencies: { foo: "1" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      const closure = reached(result);
      expect(closure.purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]);
      expect(closure.definite).toEqual([]);
      expect(closure.graph.edges.find((edge) => edge.from === closure.root.node)).toMatchObject({
        selection: "conditional",
        condition: { expression: { os: ["win32"] } },
      });
    },
  );
});

test("v6 parenthesized peer paths preserve selected bindings without treating peer ranges as resolved references", async () => {
  await input(
    {
      lockfileVersion: "6.0",
      importers: {
        ".": {
          dependencies: {
            widget: { specifier: "1", version: "1.0.0(react@18.3.1)" },
          },
        },
      },
      packages: {
        "/widget@1.0.0(react@18.3.1)": {
          peerDependencies: { react: "^18" },
          dependencies: { react: "18.3.1" },
        },
        "/react@18.3.1": {},
      },
    },
    { "package.json": { name: "app", version: "1.0.0", dependencies: { widget: "1" } } },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      expect(reached(result).purls).toEqual(["pkg:npm/react@18.3.1", "pkg:npm/widget@1.0.0"]);
      expect(
        reached(result).graph.edges.filter((edge) => edge.kind === "peerDependencies"),
      ).toHaveLength(1);
    },
  );
});

test("same-PURL local snapshots preserve different selected artifacts", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: {
        ".": {
          dependencies: {
            one: { specifier: "file:one.tgz", version: "file:one.tgz" },
            two: { specifier: "file:two.tgz", version: "file:two.tgz" },
          },
        },
      },
      packages: {
        "file:one.tgz": {
          name: "foo",
          version: "1.0.0",
          resolution: { tarball: "file:one.tgz", integrity: "sha512-one" },
        },
        "file:two.tgz": {
          name: "foo",
          version: "1.0.0",
          resolution: { tarball: "file:two.tgz", integrity: "sha512-two" },
        },
      },
      snapshots: { "file:one.tgz": {}, "file:two.tgz": {} },
    },
    {
      "package.json": {
        name: "app",
        version: "1.0.0",
        dependencies: { one: "file:one.tgz", two: "file:two.tgz" },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      const closure = reached(result);
      expect(closure.purls).toEqual(["pkg:npm/foo@1.0.0"]);
      expect(closure.definite).toHaveLength(2);
      expect(
        closure.graph.nodes
          .filter((node) => node.purl === "pkg:npm/foo@1.0.0")
          .map((node) => node.artifacts?.[0]?.location)
          .sort((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(["file:one.tgz", "file:two.tgz"]);
    },
  );
});

test("snapshot links use the lockfile root while importer links use the importer directory", async () => {
  await input(
    {
      lockfileVersion: "9.0",
      importers: {
        ".": {},
        "apps/app": {
          dependencies: {
            wrapper: { specifier: "1", version: "1.0.0" },
            ui: { specifier: "workspace:*", version: "link:../../packages/ui" },
          },
        },
        "packages/ui": {},
      },
      packages: { "wrapper@1.0.0": {} },
      snapshots: { "wrapper@1.0.0": { dependencies: { ui: "link:packages/ui" } } },
    },
    {
      "package.json": { name: "root" },
      "apps/app/package.json": { name: "app", dependencies: { wrapper: "1", ui: "workspace:*" } },
      "packages/ui/package.json": { name: "ui", version: "1.0.0" },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      const graph = reached(result, "apps/app/package.json").graph;
      const wrapper = graph.nodes.find((node) => node.purl === "pkg:npm/wrapper@1.0.0")!;
      const snapshotEdge = graph.edges.find((edge) => edge.from === wrapper.id)!;
      expect(snapshotEdge).toMatchObject({ status: "resolved", selection: "selected" });
      const importerEdge = graph.edges.find(
        (edge) =>
          edge.from === reached(result, "apps/app/package.json").root.node &&
          edge.requested?.name === "ui",
      )!;
      expect(importerEdge).toMatchObject({ status: "resolved", to: snapshotEdge.to });
    },
  );
});
