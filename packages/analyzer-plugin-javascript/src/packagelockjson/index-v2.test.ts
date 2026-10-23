import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageURL } from "packageurl-js";
import { expect, test } from "vite-plus/test";
import {
  queryDependenciesV2,
  validateResultV2,
  type AnalyzerResultV2,
} from "@scatool/analyzer-core";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { extractorV2 } from "./index-v2.ts";
import { extractor as legacyExtractor } from "./index.ts";

type RecordValue = Record<string, unknown>;
async function input(
  files: Record<string, RecordValue>,
  run: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-npm-v2-"));
  try {
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await writeFile(join(directory, file), JSON.stringify(contents, null, 2));
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const extract = (directory: string) =>
  extractorV2.extract(directory, undefined, { codebaseId: "example:npm" });
function reached(
  result: AnalyzerResultV2,
  definitionFile = "package.json",
  scope = "dependencies",
) {
  const graph = result.graphs.find(
    (graph) =>
      graph.interpretation === "locked" &&
      graph.roots.some(
        (root) => root.project.definitionFile === definitionFile && root.scope === scope,
      ),
  )!;
  const root = graph.roots.find(
    (root) => root.project.definitionFile === definitionFile && root.scope === scope,
  )!;
  const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
  const purls = (nodes: string[]) =>
    [...new Set(nodes.map((id) => graph.nodes.find((node) => node.id === id)!.purl))].sort((a, b) =>
      String(a).localeCompare(String(b)),
    );
  return {
    ...closure,
    purls: purls([...closure.definite, ...closure.conditional]),
    definitePurls: purls(closure.definite),
    graph,
    root,
  };
}

test("ancestor workspace node_modules resolves in both v2 and the corrected legacy extractor", async () => {
  const manifest = {
    name: "app",
    version: "1.0.0",
    devDependencies: { "@vitejs/plugin-react": "^6.1.1" },
  };
  await input(
    {
      "package.json": { name: "root", version: "1.0.0" },
      "packages/storefront/projects/example/react/package.json": manifest,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": { name: "root", version: "1.0.0" },
          "packages/storefront/projects/example/react": manifest,
          "packages/storefront/node_modules/@vitejs/plugin-react": { version: "6.1.1" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.issues).toEqual([]);
      expect(
        reached(
          result,
          "packages/storefront/projects/example/react/package.json",
          "devDependencies",
        ).purls,
      ).toEqual(["pkg:npm/%40vitejs/plugin-react@6.1.1"]);
      const legacy = await legacyExtractor.extract(directory);
      expect(
        legacy.subprojects.find((project) => project.definitionFile.endsWith("react/package.json"))!
          .scopes,
      ).toContainEqual({
        scope: "devDependencies",
        packages: ["pkg:npm/%40vitejs/plugin-react@6.1.1"],
      });
    },
  );
});

test("equal package versions retain different ancestor-resolved peer providers within one project", async () => {
  const manifest = {
    name: "app",
    version: "1.0.0",
    dependencies: { left: "1.0.0" },
    devDependencies: { right: "1.0.0" },
  };
  await input(
    {
      "package.json": manifest,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": manifest,
          "node_modules/left": { version: "1.0.0", dependencies: { widget: "1.0.0" } },
          "node_modules/right": { version: "1.0.0", dependencies: { widget: "1.0.0" } },
          "node_modules/left/node_modules/widget": {
            version: "1.0.0",
            peerDependencies: { react: "^18" },
          },
          "node_modules/right/node_modules/widget": {
            version: "1.0.0",
            peerDependencies: { react: "^19" },
          },
          "node_modules/left/node_modules/react": { version: "18.3.1" },
          "node_modules/right/node_modules/react": { version: "19.0.0" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
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
      expect(reached(result).definitePurls).not.toContain("pkg:npm/react@18.3.1");
      expect(
        result.graphs[0]!.nodes.filter((node) => node.purl === "pkg:npm/widget@1.0.0"),
      ).toHaveLength(2);
    },
  );
});

test("workspace consumers traverse production dependencies without leaking the workspace's dev scope", async () => {
  const root = { name: "app", version: "1.0.0", dependencies: { ui: "workspace:*" } };
  const ui = {
    name: "ui",
    version: "1.0.0",
    dependencies: { react: "18.3.1" },
    devDependencies: { vitest: "5.0.5" },
  };
  await input(
    {
      "package.json": root,
      "packages/ui/package.json": ui,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "packages/ui": ui,
          "node_modules/ui": { link: true, resolved: "packages/ui" },
          "node_modules/react": { version: "18.3.1" },
          "node_modules/vitest": { version: "5.0.5", dev: true },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual(["pkg:npm/react@18.3.1", "pkg:npm/ui@1.0.0"]);
      expect(reached(result, "packages/ui/package.json", "devDependencies").purls).toEqual([
        "pkg:npm/vitest@5.0.5",
      ]);
    },
  );
});

test("workspace names do not override a different package actually installed in the requested slot", async () => {
  const root = { name: "app", version: "1.0.0", dependencies: { ui: "npm:published-ui@2.0.0" } };
  await input(
    {
      "package.json": root,
      "packages/ui/package.json": { name: "ui", version: "1.0.0" },
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "packages/ui": { name: "ui", version: "1.0.0" },
          "node_modules/ui": { name: "published-ui", version: "2.0.0" },
        },
      },
    },
    async (directory) => {
      expect(reached(await extract(directory)).purls).toEqual(["pkg:npm/published-ui@2.0.0"]);
    },
  );
});

test("optional peers, missing peer declarations, aliases, flags and request ranges remain distinct", async () => {
  const root = {
    name: "app",
    version: "1.0.0",
    dependencies: { alias: "npm:actual@^2" },
    peerDependencies: { renderer: ">=5", absent: "^1" },
    peerDependenciesMeta: { renderer: { optional: true }, absent: { optional: true } },
  };
  await input(
    {
      "package.json": root,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "node_modules/alias": { name: "actual", version: "2.1.0" },
          "node_modules/renderer": { version: "6.7.0", devOptional: true, dev: false },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      const peer = reached(result, "package.json", "peerDependencies");
      expect(peer.definitePurls).toEqual([]);
      expect(peer.purls).toEqual(["pkg:npm/renderer@6.7.0"]);
      expect(
        peer.graph.edges.find(
          (edge) => edge.from === peer.root.node && edge.requested?.name === "renderer",
        ),
      ).toMatchObject({
        kind: "peerDependencies",
        optional: true,
        selection: "unknown",
        requested: { specifier: ">=5" },
      });
      expect(
        peer.graph.edges.find(
          (edge) => edge.from === peer.root.node && edge.requested?.name === "absent",
        ),
      ).toMatchObject({
        status: "declared",
        selection: "excluded",
        optional: true,
      });
      const direct = reached(result);
      expect(direct.purls).toEqual(["pkg:npm/actual@2.1.0"]);
      expect(
        direct.graph.edges.find((edge) => edge.from === direct.root.node)!.requested,
      ).toMatchObject({ name: "alias", specifier: "npm:actual@^2" });
      expect(
        result.graphs[0]!.nodes.find((node) => node.purl === "pkg:npm/renderer@6.7.0")!
          .attributes?.["npm:metadata"],
      ).toMatchObject({ devOptional: true, dev: false });
    },
  );
});

test("all platform alternatives remain in inventory and carry native applicability conditions", async () => {
  const root = {
    name: "app",
    version: "1.0.0",
    optionalDependencies: { linux: "1.0.0", windows: "1.0.0" },
  };
  await input(
    {
      "package.json": root,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "node_modules/linux": { version: "1.0.0", os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
          "node_modules/windows": { version: "1.0.0", os: ["win32"] },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(result.packages).toHaveLength(2);
      expect(reached(result, "package.json", "optionalDependencies").purls).toEqual([
        "pkg:npm/linux@1.0.0",
        "pkg:npm/windows@1.0.0",
      ]);
      expect(reached(result, "package.json", "optionalDependencies").definitePurls).toEqual([]);
    },
  );
});

test("optional dependencies override ordinary declarations without discarding either request", async () => {
  const root = {
    name: "app",
    version: "1.0.0",
    dependencies: { foo: "1.0.0" },
    optionalDependencies: { foo: "2.0.0" },
  };
  await input(
    {
      "package.json": root,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: { "": root, "node_modules/foo": { version: "2.0.0" } },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual([]);
      expect(reached(result, "package.json", "optionalDependencies").purls).toEqual([
        "pkg:npm/foo@2.0.0",
      ]);
      expect(
        result.graphs[0]!.edges.some(
          (edge) => edge.requested?.specifier === "1.0.0" && edge.selection === "excluded",
        ),
      ).toBe(true);
    },
  );
});

test("unresolved requests and unnamed projects are explicit without fabricated versions", async () => {
  const root = { dependencies: { foo: "^2" } };
  await input(
    { "package.json": root, "package-lock.json": { lockfileVersion: 3, packages: { "": root } } },
    async (directory) => {
      const result = await extract(directory);
      expect(PackageURL.fromString(result.subprojects[0]!.purl).type).toBe("generic");
      expect(result.subprojects[0]!.identityObservations?.[0]?.synthesizedPurl).toBe(true);
      expect(result.packages).toEqual([]);
      expect(reached(result).declarations[0]!.dependency.requested.specifier).toBe("^2");
      expect(reached(result).completeness).toBe("partial");
      expect(result.issues.some((issue) => issue.code === "npm.unresolved_dependency")).toBe(true);
    },
  );
});

test("all native npm fixture versions produce valid graphs without PURL-only adjacency", async () => {
  const directory = join(import.meta.dirname, "__fixtures__");
  for (const name of await scanFixtures(directory, "*/{package-lock.json,npm-shrinkwrap.json}")) {
    const result = await extract(join(directory, name));
    expect(
      result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
      name,
    ).toEqual([]);
    validateResultV2(result);
    expect(result.graphs.length, name).toBeGreaterThan(0);
    expect(result.subprojects.length, name).toBeGreaterThan(0);
  }
});

test("stale manifest requests, removed dependencies and changed workspace versions do not rewrite locked bindings", async () => {
  const locked = {
    name: "app",
    version: "1.0.0",
    dependencies: { foo: "^1", removed: "^1", ui: "workspace:*" },
  };
  const current = { name: "app", version: "1.0.0", dependencies: { foo: "^2", ui: "workspace:*" } };
  await input(
    {
      "package.json": current,
      "packages/ui/package.json": { name: "ui", version: "2.0.0" },
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": locked,
          "packages/ui": { name: "ui", version: "1.0.0" },
          "node_modules/ui": { link: true, resolved: "packages/ui" },
          "node_modules/foo": { version: "1.2.0" },
          "node_modules/removed": { version: "1.0.0" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual([
        "pkg:npm/foo@1.2.0",
        "pkg:npm/removed@1.0.0",
        "pkg:npm/ui@1.0.0",
      ]);
      const lockedGraph = reached(result).graph;
      expect(
        lockedGraph.edges.find(
          (edge) => edge.from === reached(result).root.node && edge.requested?.name === "foo",
        )!.requested?.specifier,
      ).toBe("^1");
      const declared = result.graphs.find((graph) => graph.interpretation === "declared")!;
      const root = declared.roots.find(
        (root) => root.project.definitionFile === "package.json" && root.scope === "dependencies",
      )!;
      const declarations = queryDependenciesV2(result, {
        graph: declared.id,
        root: root.id,
      }).declarations;
      expect(
        declarations
          .map((record) => record.dependency.requested.name)
          .sort((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(["foo", "ui"]);
      expect(
        declarations.find((record) => record.dependency.requested.name === "foo")!.dependency
          .requested.specifier,
      ).toBe("^2");
      expect(
        declared.nodes.some(
          (node) =>
            node.project?.definitionFile === "packages/ui/package.json" &&
            node.purl === "pkg:npm/ui@2.0.0",
        ),
      ).toBe(true);
      expect(
        result.issues.filter((issue) => issue.code === "npm.manifest_lock_mismatch"),
      ).toHaveLength(2);
    },
  );
});

test("legacy aliases use actual coordinates and nonregistry locators are not fabricated package versions", async () => {
  await input(
    {
      "package.json": {
        name: "app",
        version: "1.0.0",
        dependencies: {
          alias: "npm:actual@^1",
          scoped: "npm:@scope/actual@^2",
          git: "github:example/repo",
          tar: "https://example.com/pkg.tgz",
        },
      },
      "package-lock.json": {
        lockfileVersion: 1,
        dependencies: {
          alias: { version: "npm:actual@1.2.3" },
          scoped: { version: "npm:@scope/actual@2.3.4" },
          git: {
            version: "git+https://github.com/example/repo.git#abcdef",
            resolved: "git+https://github.com/example/repo.git#abcdef",
          },
          tar: { version: "https://example.com/pkg.tgz", integrity: "sha512-content" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual([
        "pkg:npm/%40scope/actual@2.3.4",
        "pkg:npm/actual@1.2.3",
        "pkg:npm/git",
        "pkg:npm/tar",
      ]);
      expect(reached(result).definitePurls).toEqual([]);
      expect(
        reached(result).graph.nodes.find((node) => node.purl === "pkg:npm/actual@1.2.3")!
          .attributes?.["npm:metadata"],
      ).toMatchObject({ "npm:aliasVersion": "npm:actual@1.2.3" });
      expect(result.issues).toEqual([]);
    },
  );
});

test("linked workspace platform restrictions condition the whole downstream path", async () => {
  const root = { name: "app", version: "1.0.0", dependencies: { ui: "workspace:*" } };
  const ui = { name: "ui", version: "1.0.0", os: ["linux"], dependencies: { foo: "1.0.0" } };
  await input(
    {
      "package.json": root,
      "packages/ui/package.json": ui,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "packages/ui": ui,
          "node_modules/ui": { link: true, resolved: "packages/ui" },
          "node_modules/foo": { version: "1.0.0" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).definitePurls).toEqual([]);
      expect(reached(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]);
      expect(
        reached(result).graph.edges.find((edge) => edge.from === reached(result).root.node),
      ).toMatchObject({ selection: "conditional", condition: { expression: { os: ["linux"] } } });
    },
  );
});

test("nearer unresolved links shadow ancestor packages and same-PURL views retain selected artifacts", async () => {
  const root = { name: "app", version: "1.0.0", dependencies: { left: "1", right: "1" } };
  await input(
    {
      "package.json": root,
      "package-lock.json": {
        lockfileVersion: 3,
        packages: {
          "": root,
          "node_modules/left": { version: "1.0.0", dependencies: { foo: "1", blocked: "1" } },
          "node_modules/right": { version: "1.0.0", dependencies: { foo: "1" } },
          "node_modules/left/node_modules/foo": {
            version: "1.0.0",
            resolved: "https://one.example/foo.tgz",
            integrity: "sha512-one",
          },
          "node_modules/right/node_modules/foo": {
            version: "1.0.0",
            resolved: "https://two.example/foo.tgz",
            integrity: "sha512-two",
          },
          "node_modules/left/node_modules/blocked": { link: true, resolved: "missing/workspace" },
          "node_modules/blocked": { version: "1.0.0" },
        },
      },
    },
    async (directory) => {
      const result = await extract(directory);
      expect(reached(result).purls).toEqual([
        "pkg:npm/foo@1.0.0",
        "pkg:npm/left@1.0.0",
        "pkg:npm/right@1.0.0",
      ]);
      expect(
        reached(result).declarations.map((record) => record.dependency.requested.name),
      ).toContain("blocked");
      const views = reached(result).graph.nodes.filter((node) => node.purl === "pkg:npm/foo@1.0.0");
      expect(views).toHaveLength(2);
      expect(
        views
          .map((view) => view.artifacts?.[0]?.attributes?.["npm:integrity"])
          .filter((value): value is string => typeof value === "string")
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(["sha512-one", "sha512-two"]);
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:npm/foo@1.0.0")!.artifacts,
      ).toHaveLength(2);
    },
  );
});
