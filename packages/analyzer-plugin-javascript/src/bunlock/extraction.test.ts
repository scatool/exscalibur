import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult, type AnalyzerResult } from "@scatool/analyzer-core";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { extractor } from "./index.ts";

type RecordValue = Record<string, unknown>;
async function input(
  lock: RecordValue,
  manifests: Record<string, RecordValue>,
  run: (result: AnalyzerResult) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-bun-"));
  try {
    await writeFile(join(directory, "bun.lock"), JSON.stringify({ lockfileVersion: 1, ...lock }));
    for (const [file, manifest] of Object.entries(manifests)) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await writeFile(join(directory, file), JSON.stringify(manifest));
    }
    const result = await extractor.extract(directory, undefined, { codebaseId: "example:bun" });
    validateResult(result);
    expect(result.issues.filter((issue) => issue.code === "core.file_extraction_failed")).toEqual(
      [],
    );
    run(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function closure(result: AnalyzerResult, file = "package.json", scope = "dependencies") {
  const graph = result.graphs.find((graph) => graph.source.extractor === "bunlock")!;
  const root = graph.roots.find(
    (root) => root.project.definitionFile === file && root.scope === scope,
  )!;
  const closure = queryDependencies(result, { graph: graph.id, root: root.id });
  const purls = [
    ...new Set(
      [...closure.definite, ...closure.conditional].map(
        (id) => graph.nodes.find((node) => node.id === id)!.purl,
      ),
    ),
  ].sort();
  return { ...closure, graph, root, purls };
}
const tuple = (name: string, version: string, metadata: RecordValue = {}) => [
  `${name}@${version}`,
  "",
  metadata,
  "",
];

test.each([
  ["missing", ["foo@1.0.0", ""]],
  ["wrong type", ["foo@1.0.0", "", []]],
])("invalid npm INFO (%s) retains unknown adjacency", async (_label, value) => {
  const root = { name: "app", dependencies: { foo: "1" } };
  await input(
    { workspaces: { "": root }, packages: { foo: value } },
    { "package.json": root },
    (result) => {
      const reached = closure(result);
      expect(reached.purls).toEqual(["pkg:npm/foo@1.0.0"]);
      expect(reached.completeness).toBe("unknown");
      expect(
        reached.graph.nodes.find((node) => node.locator === "foo")!.dependencyCompleteness,
      ).toBe("unknown");
      expect(result.issues.some((issue) => issue.code === "bun.invalid_package_info")).toBe(true);
    },
  );
});

test("invalid v0 workspace INFO cannot produce a known consumer leaf", async () => {
  const root = { name: "app", dependencies: { ui: "workspace:*" } };
  const ui = { name: "ui", version: "1.0.0" };
  await input(
    {
      lockfileVersion: 0,
      workspaces: { "": root, "packages/ui": ui },
      packages: { ui: ["ui@workspace:packages/ui", 42] },
    },
    {
      "package.json": root,
      "packages/ui/package.json": ui,
    },
    (result) => {
      expect(closure(result).completeness).toBe("unknown");
      expect(
        closure(result).graph.nodes.find((node) => node.locator === "ui")!.dependencyCompleteness,
      ).toBe("unknown");
    },
  );
});

test("Bun placement paths retain distinct peer contexts for equal PURLs", async () => {
  const root = { name: "app", dependencies: { left: "1" }, devDependencies: { right: "1" } };
  await input(
    {
      workspaces: { "": root },
      packages: {
        left: tuple("left", "1.0.0", { dependencies: { widget: "1" } }),
        right: tuple("right", "1.0.0", { dependencies: { widget: "1" } }),
        "left/widget": tuple("widget", "1.0.0", { peerDependencies: { react: "^18" } }),
        "right/widget": tuple("widget", "1.0.0", { peerDependencies: { react: "^19" } }),
        "left/react": tuple("react", "18.3.1"),
        "right/react": tuple("react", "19.0.0"),
      },
    },
    { "package.json": root },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/left@1.0.0",
        "pkg:npm/react@18.3.1",
        "pkg:npm/widget@1.0.0",
      ]);
      expect(closure(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/react@19.0.0",
        "pkg:npm/right@1.0.0",
        "pkg:npm/widget@1.0.0",
      ]);
      expect(
        closure(result).graph.nodes.filter((node) => node.purl === "pkg:npm/widget@1.0.0"),
      ).toHaveLength(2);
      expect(
        closure(result).graph.edges.find((edge) => edge.kind === "peerDependencies")!.selection,
      ).toBe("unknown");
    },
  );
});

test("workspace aliases retain consumer adjacency without traversing development scope roots", async () => {
  const root = { name: "app", dependencies: { ui: "workspace:*" } };
  const ui = {
    name: "ui",
    version: "1.0.0",
    dependencies: { foo: "1" },
    devDependencies: { test: "1" },
  };
  await input(
    {
      workspaces: { "": root, "packages/ui": ui },
      packages: {
        ui: ["ui@workspace:packages/ui"],
        foo: tuple("foo", "1.0.0"),
        test: tuple("test", "1.0.0"),
      },
    },
    { "package.json": root, "packages/ui/package.json": ui },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]);
      expect(closure(result, "packages/ui/package.json", "devDependencies").purls).toEqual([
        "pkg:npm/test@1.0.0",
      ]);
      expect(
        closure(result).graph.nodes.some(
          (node) =>
            node.locator === "ui" && node.project?.definitionFile === "packages/ui/package.json",
        ),
      ).toBe(true);
    },
  );
});

test("unlinked workspace subtrees remain distinct from a registry package with the same name", async () => {
  const root = { name: "app", dependencies: { ui: "^1" }, devDependencies: { ui: "workspace:*" } };
  const ui = { name: "ui", version: "2.0.0", dependencies: { foo: "2" } };
  await input(
    {
      workspaces: { "": root, "packages/ui": ui },
      packages: {
        ui: tuple("ui", "1.0.0", { dependencies: { foo: "1" } }),
        "./ui": ["ui@workspace:packages/ui"],
        "ui/foo": tuple("foo", "1.0.0"),
        "./ui/foo": tuple("foo", "2.0.0"),
      },
    },
    { "package.json": root, "packages/ui/package.json": ui },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]);
      expect(closure(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/foo@2.0.0",
        "pkg:npm/ui@2.0.0",
      ]);
      expect(closure(result, "packages/ui/package.json").purls).toEqual(["pkg:npm/foo@2.0.0"]);
    },
  );
});

test("scoped parent names are single path segments during ancestor resolution", async () => {
  const root = { name: "app", dependencies: { "@scope/parent": "1" } };
  await input(
    {
      workspaces: { "": root },
      packages: {
        "@scope/parent": tuple("@scope/parent", "1.0.0", { dependencies: { "@scope/child": "1" } }),
        "@scope/parent/@scope/child": tuple("@scope/child", "1.0.0", {
          dependencies: { foo: "1" },
        }),
        "@scope/parent/foo": tuple("foo", "1.0.0"),
        foo: tuple("foo", "2.0.0"),
      },
    },
    { "package.json": root },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/%40scope/child@1.0.0",
        "pkg:npm/%40scope/parent@1.0.0",
        "pkg:npm/foo@1.0.0",
      ]);
    },
  );
});

test("git/folder/tarball tuples use their actual metadata index without fabricated locator versions", async () => {
  const root = {
    name: "app",
    dependencies: { git: "github:example/repo", tar: "https://example.com/archive.tgz" },
  };
  await input(
    {
      workspaces: { "": root },
      packages: {
        git: [
          "actual-git@github:example/repo#abcdef",
          { dependencies: { child: "1" } },
          "cache-tag",
        ],
        tar: ["actual-tar@https://example.com/archive.tgz", { dependencies: { child: "1" } }],
        child: tuple("child", "1.0.0"),
      },
    },
    { "package.json": root },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/actual-git",
        "pkg:npm/actual-tar",
        "pkg:npm/child@1.0.0",
      ]);
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:npm/actual-tar")!.artifacts?.[0]?.location,
      ).toBe("https://example.com/archive.tgz");
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:npm/actual-git")!.artifacts,
      ).toBeUndefined();
    },
  );
});

test("an explicitly unresolved optional dependency cannot rebind to a same-name inventory package", async () => {
  const root = { name: "app", dependencies: { parent: "1" } };
  await input(
    {
      workspaces: { "": root },
      packages: {
        parent: tuple("parent", "1.0.0", {
          optionalDependencies: { foo: "^2" },
          unresolved: ["foo"],
        }),
        foo: tuple("foo", "1.0.0"),
      },
    },
    { "package.json": root },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/parent@1.0.0"]);
      expect(
        closure(result).graph.edges.find((edge) => edge.requested?.name === "foo"),
      ).toMatchObject({
        status: "declared",
        selection: "excluded",
        optional: true,
        attributes: { "bun:explicitlyUnresolved": true },
      });
    },
  );
});

test("optional peers and platform alternatives preserve native conditions and uncertainty", async () => {
  const root = {
    name: "app",
    dependencies: { parent: "1" },
    optionalDependencies: { windows: "1" },
  };
  await input(
    {
      workspaces: { "": root },
      packages: {
        parent: tuple("parent", "1.0.0", {
          peerDependencies: { host: "^1" },
          optionalPeers: ["host"],
        }),
        host: tuple("host", "1.0.0"),
        windows: tuple("windows", "1.0.0", { os: "win32", cpu: "x64" }),
      },
    },
    { "package.json": root },
    (result) => {
      expect(
        closure(result).graph.edges.find((edge) => edge.kind === "peerDependencies"),
      ).toMatchObject({ optional: true, selection: "unknown" });
      expect(closure(result, "package.json", "optionalDependencies").purls).toEqual([
        "pkg:npm/windows@1.0.0",
      ]);
      expect(closure(result, "package.json", "optionalDependencies").definite).toEqual([]);
    },
  );
});

test("manifest drift does not overwrite native Bun workspace declarations", async () => {
  await input(
    {
      workspaces: { "": { name: "app", dependencies: { foo: "^1" } } },
      packages: { foo: tuple("foo", "1.0.0") },
    },
    {
      "package.json": { name: "app", dependencies: { foo: "^2" } },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0"]);
      expect(
        closure(result).graph.edges.find((edge) => edge.from === closure(result).root.node)!
          .requested?.specifier,
      ).toBe("^1");
      expect(
        result.graphs.find((graph) => graph.interpretation === "declared")!.edges[0]!.requested
          ?.specifier,
      ).toBe("^2");
      expect(result.issues[0]!.code).toBe("bun.manifest_lock_mismatch");
    },
  );
});

test("all native Bun fixture variants retain valid context references", async () => {
  const fixtures = join(import.meta.dirname, "__fixtures__");
  for (const name of await scanFixtures(fixtures, "*/bun.lock")) {
    const result = await extractor.extract(join(fixtures, name));
    expect(
      result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
      name,
    ).toEqual([]);
    validateResult(result);
    expect(result.packages.length, name).toBeGreaterThan(0);
  }
});

test("v0 workspace tuple INFO preserves its effective dependency context and unresolved flags", async () => {
  const root = { name: "app", dependencies: { ui: "workspace:*" } };
  const ui = { name: "ui", version: "1.0.0", dependencies: { foo: "1" } };
  await input(
    {
      lockfileVersion: 0,
      workspaces: { "": root, "packages/ui": ui },
      packages: {
        ui: [
          "ui@workspace:packages/ui",
          { dependencies: { foo: "2" }, optionalDependencies: { bar: "2" }, unresolved: ["bar"] },
        ],
        "ui/foo": tuple("foo", "2.0.0"),
        bar: tuple("bar", "1.0.0"),
      },
    },
    { "package.json": root, "packages/ui/package.json": ui },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@2.0.0", "pkg:npm/ui@1.0.0"]);
      const alias = closure(result).graph.nodes.find((node) => node.locator === "ui")!;
      expect(
        closure(result).graph.edges.find(
          (edge) => edge.from === alias.id && edge.requested?.name === "bar",
        ),
      ).toMatchObject({ selection: "excluded", attributes: { "bun:explicitlyUnresolved": true } });
    },
  );
});

test("external catalog requests remain unbound despite same-name placement inventory", async () => {
  const root = { name: "app", dependencies: { parent: "1" } };
  await input(
    {
      workspaces: { "": root },
      packages: {
        parent: tuple("parent", "1.0.0", { dependencies: { foo: "catalog:" } }),
        foo: tuple("foo", "1.0.0"),
      },
    },
    {
      "package.json": root,
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/parent@1.0.0"]);
      expect(closure(result).declarations[0]!.dependency).toMatchObject({
        requested: { specifier: "catalog:" },
        attributes: { "bun:catalogReferenceStripped": true },
      });
    },
  );
});

test.each([2, 3])(
  "Bun v%s artifact layouts and source configuration remain attributable",
  async (lockfileVersion) => {
    const root = {
      name: "app",
      dependencies: { npm: "1", tar: "https://example.com/file.tgz", git: "github:example/repo" },
    };
    await input(
      {
        lockfileVersion,
        overrides: { "parent@1": { "foo@^1": "2.0.0" } },
        workspaces: { "": root },
        packages: {
          npm: ["npm@1.0.0", "https://custom.example.com/npm.tgz", {}, "sha512-npm"],
          tar: ["tar@https://example.com/file.tgz", {}, "sha512-tar"],
          git: ["git@github:example/repo#abcdef", {}, "safe-cache-tag", "sha512-git"],
        },
      },
      { "package.json": root },
      (result) => {
        expect(
          result.packages.find((pkg) => pkg.purl === "pkg:npm/npm@1.0.0")!.artifacts?.[0]?.location,
        ).toBe("https://custom.example.com/npm.tgz");
        expect(
          result.packages.find((pkg) => pkg.purl === "pkg:npm/tar")!.artifacts?.[0]?.attributes,
        ).toMatchObject({ "npm:integrity": "sha512-tar" });
        expect(
          result.packages.find((pkg) => pkg.purl === "pkg:npm/git")!.artifacts?.[0]?.attributes,
        ).toMatchObject({ "npm:integrity": "sha512-git" });
        expect(closure(result).graph.attributes?.["bun:metadata"]).toMatchObject({
          overrides: { "parent@1": { "foo@^1": "2.0.0" } },
        });
      },
    );
  },
);

test("native root sentinel metadata stays attached to its analyzed project", async () => {
  const root = { name: "app", dependencies: { foo: "1" } };
  await input(
    {
      workspaces: { "": root },
      packages: { root: ["@root:", { bin: "cli.js" }], foo: tuple("foo", "1.0.0") },
    },
    {
      "package.json": root,
    },
    (result) => {
      const sentinel = closure(result).graph.nodes.find((node) => node.locator === "root")!;
      expect(sentinel.project?.definitionFile).toBe("package.json");
      expect(sentinel.purl).toBe("pkg:npm/app");
      expect(sentinel.attributes?.["bun:tuple"]).toEqual(["@root:", { bin: "cli.js" }]);
    },
  );
});

test("recognized binary Bun files report unknown coverage instead of a complete empty result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-bun-"));
  try {
    await writeFile(join(directory, "bun.lockb"), new Uint8Array([0, 1, 2, 3]));
    const result = await extractor.extract(directory);
    expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
    expect(result.issues).toMatchObject([
      { code: "core.file_extraction_failed", file: "bun.lockb" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
