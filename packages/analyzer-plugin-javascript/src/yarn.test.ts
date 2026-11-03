import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyClassicLock } from "@yarnpkg/lockfile";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult, type AnalyzerResult } from "@scatool/analyzer-core";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { extractor as berry } from "./yarnberry/index.ts";
import { extractor as classic } from "./yarnlock/index.ts";

type RecordValue = Record<string, unknown>;
async function input(
  modern: boolean,
  entries: RecordValue | string,
  manifests: Record<string, RecordValue>,
  run: (result: AnalyzerResult) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-yarn-"));
  try {
    await writeFile(
      join(directory, "yarn.lock"),
      typeof entries === "string"
        ? entries
        : modern
          ? stringify({ __metadata: { version: 8 }, ...entries })
          : stringifyClassicLock(entries),
    );
    for (const [file, manifest] of Object.entries(manifests)) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await writeFile(join(directory, file), JSON.stringify(manifest));
    }
    const result = await (modern ? berry : classic).extract(directory, undefined, {
      codebaseId: "example:yarn",
    });
    validateResult(result);
    expect(result.issues.filter((issue) => issue.code === "core.file_extraction_failed")).toEqual(
      [],
    );
    run(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function closure(
  result: AnalyzerResult,
  file = "package.json",
  scope = "dependencies",
  native = false,
) {
  const graph = result.graphs.find(
    (graph) =>
      graph.attributes?.["yarn:observation"] ===
      (native ? "native-lock" : "current-manifest-scopes"),
  )!;
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
const workspace = (name: string, path: string, dependencies: RecordValue = {}) => ({
  version: "0.0.0-use.local",
  resolution: `${name}@workspace:${path}`,
  dependencies,
  linkType: "soft",
});
const external = (name: string, version = "1.0.0", more: RecordValue = {}) => ({
  version,
  resolution: `${name}@npm:${version}`,
  linkType: "hard",
  ...more,
});

test("modern native YAML preserves unquoted numeric ranges and parses optional flags", async () => {
  await input(
    true,
    `__metadata:
  version: 8
"app@workspace:.":
  version: 0.0.0-use.local
  resolution: "app@workspace:."
  dependencies:
    foo: "npm:1"
"foo@npm:1":
  version: 1.0.0
  resolution: "foo@npm:1.0.0"
  peerDependencies:
    host: 6
  peerDependenciesMeta:
    host:
      optional: true
`,
    { "package.json": { name: "app", dependencies: { foo: "1" } } },
    (result) => {
      for (const graph of result.graphs.filter((graph) => graph.interpretation === "locked")) {
        expect(graph.edges.find((edge) => edge.kind === "peerDependencies")).toMatchObject({
          requested: { name: "host", specifier: "6" },
          optional: true,
          status: "declared",
          selection: "unknown",
        });
      }
    },
  );
});

test.each([4, 5, 6, 8])(
  "version %s uses native descriptor compatibility without rewriting locators",
  async (version) => {
    await input(
      true,
      {
        __metadata: { version },
        "app@workspace:.": workspace("app", ".", { foo: "npm:^1" }),
        "foo@^1,foo@~1": external("foo"),
      },
      { "package.json": { name: "app", dependencies: { foo: "^1" } } },
      (result) => {
        expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual(
          version <= 6 ? ["pkg:npm/foo@1.0.0"] : [],
        );
        expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0"]);
        expect(closure(result).definite).toHaveLength(version <= 6 ? 1 : 0);
        const node = closure(result).graph.nodes.find((node) => node.purl === "pkg:npm/foo@1.0.0")!;
        expect(node.locator).toBe("foo@npm:1.0.0");
        expect(node.attributes?.["yarn:descriptors"]).toEqual(["foo@^1", "foo@~1"]);
      },
    );
  },
);

test("raw lock descriptors do not claim Yarn's effective compatibility patch selection", async () => {
  // Pinned Yarn info on Algolia applies compat/typescript before binding. The raw
  // lock also retains the unpatched descriptor; the observations have different targets.
  const patched =
    "typescript@patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>::version=5.9.3&hash=5786d5";
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { typescript: "npm:5.9.3" }),
      "typescript@npm:5.9.3": external("typescript", "5.9.3", { checksum: "native-unpatched" }),
      "typescript@patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>": {
        version: "5.9.3",
        resolution: patched,
        checksum: "native-patched",
      },
    },
    { "package.json": { name: "app", dependencies: { typescript: "5.9.3" } } },
    (result) => {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "yarn.raw_lock_projection", severity: "HINT" }),
      );
      for (const graph of result.graphs.filter((graph) => graph.interpretation === "locked")) {
        expect(graph.attributes).toMatchObject({
          "yarn:projection": "raw-descriptor-map",
          "yarn:effectiveResolution": "not-observed",
          "yarn:resolverTransformations": "not-applied",
        });
        const views = graph.nodes.filter((node) => node.purl === "pkg:npm/typescript@5.9.3");
        expect(new Set(views.map((view) => view.locator))).toEqual(
          new Set(["typescript@npm:5.9.3", patched]),
        );
        expect(
          new Set(views.map((view) => (view.attributes!["yarn:record"] as RecordValue).checksum)),
        ).toEqual(new Set(["native-unpatched", "native-patched"]));
        const root = graph.roots.find(
          (root) =>
            root.scope ===
            (graph.attributes!["yarn:observation"] === "native-lock"
              ? "yarn:dependencies"
              : "dependencies"),
        )!;
        expect(graph.edges.find((edge) => edge.from === root.node)).toMatchObject({
          to: views.find((node) => node.locator === "typescript@npm:5.9.3")!.id,
          selection: "unknown",
        });
        const dependencies = queryDependencies(result, { graph: graph.id, root: root.id });
        expect(dependencies.definite).toEqual([]);
        expect(dependencies.conditional).toHaveLength(1);
        expect(dependencies.completeness).toBe("unknown");
      }
    },
  );
});

test("native merged workspace roots and current consumption retain separate adjacency", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { ui: "workspace:*" }),
      "ui@workspace:*, ui@workspace:packages/ui": workspace("ui", "packages/ui", {
        foo: "npm:1",
        test: "npm:1",
      }),
      "foo@npm:1": external("foo"),
      "test@npm:1": external("test"),
    },
    {
      "package.json": { name: "app", version: "1.0.0", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": {
        name: "ui",
        version: "1.0.0",
        dependencies: { foo: "1" },
        devDependencies: { test: "1" },
      },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]);
      expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual([
        "pkg:npm/foo@1.0.0",
        "pkg:npm/test@1.0.0",
        "pkg:npm/ui@1.0.0",
      ]);
      expect(closure(result, "packages/ui/package.json", "devDependencies").purls).toEqual([
        "pkg:npm/test@1.0.0",
      ]);
      expect(result.issues.filter((issue) => issue.severity !== "HINT")).toEqual([]);
    },
  );
});

test("an unchanged descriptor moved to development uses current scope provenance without rewriting native lock roots", async () => {
  await input(
    true,
    { "app@workspace:.": workspace("app", ".", { foo: "npm:^1" }), "foo@npm:^1": external("foo") },
    {
      "package.json": { name: "app", version: "1.0.0", devDependencies: { foo: "^1" } },
    },
    (result) => {
      expect(closure(result).purls).toEqual([]);
      expect(closure(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/foo@1.0.0",
      ]);
      expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual([
        "pkg:npm/foo@1.0.0",
      ]);
      expect(closure(result).graph.attributes?.["yarn:scopeSource"]).toBe("current-manifests");
    },
  );
});

test("a production request also listed in development remains reachable from a consumed workspace", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { ui: "workspace:*" }),
      "ui@workspace:*, ui@workspace:packages/ui": workspace("ui", "packages/ui", { foo: "npm:1" }),
      "foo@npm:1": external("foo"),
    },
    {
      "package.json": { name: "app", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": {
        name: "ui",
        version: "1.0.0",
        dependencies: { foo: "1" },
        devDependencies: { foo: "1" },
      },
    },
    (result) => expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/ui@1.0.0"]),
  );
});

test("changed requests stay unbound while the original native bindings remain queryable", async () => {
  await input(
    true,
    { "app@workspace:.": workspace("app", ".", { foo: "npm:^1" }), "foo@npm:^1": external("foo") },
    {
      "package.json": { name: "app", dependencies: { foo: "^2" } },
    },
    (result) => {
      expect(closure(result).purls).toEqual([]);
      expect(closure(result).declarations[0]!.dependency.requested.specifier).toBe("^2");
      expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual([
        "pkg:npm/foo@1.0.0",
      ]);
      expect(result.issues[0]!.code).toBe("yarn.manifest_lock_mismatch");
    },
  );
});

test("missing manifests retain native workspace identity without turning local version markers into versions", async () => {
  await input(
    true,
    { "app@workspace:.": workspace("app", ".", { foo: "npm:1" }), "foo@npm:1": external("foo") },
    {},
    (result) => {
      expect(result.subprojects.some((project) => project.purl === "pkg:npm/app")).toBe(true);
      expect(result.subprojects.some((project) => project.purl.includes("use.local"))).toBe(false);
      expect(
        result.graphs.find(
          (graph) => graph.attributes?.["yarn:observation"] === "current-manifest-scopes",
        )!.rootCompleteness,
      ).toBe("partial");
      const graph = result.graphs.find(
        (graph) => graph.attributes?.["yarn:observation"] === "native-lock",
      )!;
      const dependencies = queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id });
      expect(dependencies.definite).toEqual([]);
      expect(dependencies.conditional).toHaveLength(1);
      expect(dependencies.completeness).toBe("unknown");
    },
  );
});

test("unbound optional peers remain unknown declarations even if a same-name package exists in inventory", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { widget: "npm:1" }),
      "widget@npm:1": external("widget", "1.0.0", {
        peerDependencies: { host: "^1" },
        peerDependenciesMeta: { host: { optional: true } },
      }),
      "host@npm:1": external("host"),
    },
    { "package.json": { name: "app", dependencies: { widget: "1" } } },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/widget@1.0.0"]);
      expect(closure(result).declarations[0]!.dependency).toMatchObject({
        status: "declared",
        selection: "unknown",
        optional: true,
        requested: { name: "host", specifier: "^1" },
      });
      expect(closure(result).completeness).toBe("unknown");
    },
  );
});

test("two patch locators with equal PURLs retain different outgoing views and native checksums", async () => {
  const one = "patch:foo@npm%3A1.0.0#one::hash=one";
  const two = "patch:foo@npm%3A1.0.0#two::hash=two";
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { one, two }),
      [`one@${one}`]: {
        ...external("foo"),
        resolution: `foo@${one}`,
        checksum: "cache/one",
        dependencies: { left: "npm:1" },
      },
      [`two@${two}`]: {
        ...external("foo"),
        resolution: `foo@${two}`,
        checksum: "cache/two",
        dependencies: { right: "npm:1" },
      },
      "left@npm:1": external("left"),
      "right@npm:1": external("right"),
    },
    { "package.json": { name: "app", dependencies: { one }, devDependencies: { two } } },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0", "pkg:npm/left@1.0.0"]);
      expect(closure(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/foo@1.0.0",
        "pkg:npm/right@1.0.0",
      ]);
      expect(
        closure(result).graph.nodes.filter((node) => node.purl === "pkg:npm/foo@1.0.0"),
      ).toHaveLength(2);
      expect(
        closure(result).graph.nodes.find((node) => node.locator === `foo@${one}`)!.attributes?.[
          "yarn:record"
        ],
      ).toMatchObject({ checksum: "cache/one" });
    },
  );
});

test("native platform predicates and dependency optional metadata are preserved without host filtering", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { linux: "npm:1", windows: "npm:1" }),
      "linux@npm:1": external("linux", "1.0.0", { conditions: "os=linux & cpu=x64 & libc=glibc" }),
      "windows@npm:1": external("windows", "1.0.0", { conditions: "os=win32 & cpu=x64" }),
    },
    { "package.json": { name: "app", optionalDependencies: { linux: "1", windows: "1" } } },
    (result) => {
      const reached = closure(result, "package.json", "optionalDependencies");
      expect(reached.purls).toEqual(["pkg:npm/linux@1.0.0", "pkg:npm/windows@1.0.0"]);
      expect(reached.definite).toEqual([]);
      expect(
        reached.graph.edges
          .filter((edge) => edge.from === reached.root.node)
          .every((edge) => edge.optional && edge.condition?.language === "yarn:applicability/v1"),
      ).toBe(true);
    },
  );
});

test("Classic aliases and quoted scoped dependencies retain exact native identity and descriptor resolution", async () => {
  await input(
    false,
    {
      "parent@^1": { version: "1.0.0", dependencies: { "@scope/child": "^2" } },
      "@scope/child@^2": { version: "2.0.0" },
      "alias@npm:@scope/actual@^1": {
        version: "1.2.3",
        resolved: "https://example.com/actual.tgz",
        integrity: "sha512-content",
      },
    },
    {
      "package.json": {
        name: "app",
        dependencies: { parent: "^1", alias: "npm:@scope/actual@^1" },
      },
    },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/%40scope/actual@1.2.3",
        "pkg:npm/%40scope/child@2.0.0",
        "pkg:npm/parent@1.0.0",
      ]);
      expect(closure(result).completeness).toBe("unknown");
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:npm/%40scope/actual@1.2.3")!.artifacts?.[0]
          ?.location,
      ).toBe("https://example.com/actual.tgz");
    },
  );
});

test("Classic workspace selection respects compatibility and never shadows a different registry request by name", async () => {
  await input(
    false,
    {
      "ui@^1": { version: "1.0.0", dependencies: { react: "18" } },
      "react@18": { version: "18.0.0" },
      "react@19": { version: "19.0.0" },
    },
    {
      "package.json": {
        name: "app",
        workspaces: { packages: ["packages/*"] },
        dependencies: { ui: "^1" },
        devDependencies: { ui: "^2" },
      },
      "packages/ui/package.json": { name: "ui", version: "2.0.0", dependencies: { react: "19" } },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/react@18.0.0", "pkg:npm/ui@1.0.0"]);
      expect(closure(result, "package.json", "devDependencies").purls).toEqual([
        "pkg:npm/react@19.0.0",
        "pkg:npm/ui@2.0.0",
      ]);
    },
  );
});

test("Classic missing exact descriptors never choose the first package with the same name", async () => {
  await input(
    false,
    { "foo@^1": { version: "1.0.0" } },
    { "package.json": { name: "app", dependencies: { foo: "^2" } } },
    (result) => {
      expect(closure(result).purls).toEqual([]);
      expect(closure(result).declarations[0]!.dependency.requested.specifier).toBe("^2");
    },
  );
});

// Each corpus member is an independent extraction, with its own timeout and
// failure label instead of sharing one five-second budget across all fixtures.
for (const [kind, extractor] of [
  ["yarnlock", classic],
  ["yarnberry", berry],
] as const) {
  const fixtures = join(import.meta.dirname, kind, "__fixtures__");
  for (const name of await scanFixtures(fixtures, "*/yarn.lock")) {
    test(`native Yarn fixture ${kind}/${name} produces valid graph-local references`, async () => {
      const result = await extractor.extract(join(fixtures, name));
      expect(
        result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
        `${kind}/${name}`,
      ).toEqual([]);
      validateResult(result);
      expect(result.packages.length, `${kind}/${name}`).toBeGreaterThan(0);
    });
  }
}

test("removed lock-only workspace dependencies remain native and make correlated consumption partial", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { ui: "workspace:*" }),
      "ui@workspace:*, ui@workspace:packages/ui": workspace("ui", "packages/ui", {
        removed: "npm:1",
      }),
      "removed@npm:1": external("removed"),
    },
    {
      "package.json": { name: "app", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": { name: "ui", version: "1.0.0" },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/ui@1.0.0"]);
      expect(closure(result).completeness).toBe("partial");
      expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual([
        "pkg:npm/removed@1.0.0",
        "pkg:npm/ui@1.0.0",
      ]);
      expect(
        result.issues.some(
          (issue) =>
            issue.code === "yarn.manifest_lock_mismatch" &&
            issue.file === "packages/ui/package.json",
        ),
      ).toBe(true);
    },
  );
});

test("Yarn optional metadata survives native, scoped and original declaration observations", async () => {
  await input(
    true,
    {
      "app@workspace:.": {
        ...workspace("app", ".", { foo: "npm:1" }),
        dependenciesMeta: { foo: { optional: true } },
      },
      "foo@npm:1": external("foo"),
    },
    {
      "package.json": {
        name: "app",
        dependencies: { foo: "1" },
        dependenciesMeta: { foo: { optional: true } },
      },
    },
    (result) => {
      for (const graph of result.graphs) {
        expect(
          graph.edges
            .filter((edge) => edge.requested?.name === "foo")
            .every((edge) => edge.optional === true),
        ).toBe(true);
      }
    },
  );
});

test("version-qualified optional metadata is applied only when the selected version establishes it", async () => {
  await input(
    true,
    { "app@workspace:.": workspace("app", ".", { foo: "npm:^1" }), "foo@npm:^1": external("foo") },
    {
      "package.json": {
        name: "app",
        dependencies: { foo: "^1" },
        dependenciesMeta: { "foo@1.0.0": { optional: true } },
      },
    },
    (result) => {
      const reached = closure(result);
      expect(reached.graph.edges.find((edge) => edge.from === reached.root.node)!.optional).toBe(
        true,
      );
      const declared = result.graphs.find((graph) => graph.interpretation === "declared")!;
      expect(declared.edges[0]!.optional).toBeUndefined();
      expect(
        declared.nodes.some((node) =>
          (JSON.stringify(node.attributes) ?? "").includes('"foo@1.0.0"'),
        ),
      ).toBe(true);
    },
  );
});

test("a stale request present elsewhere in the lockfile remains an uncertain candidate", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { foo: "npm:^1" }),
      "foo@npm:^1": external("foo"),
      "foo@npm:^2": external("foo", "2.0.0"),
    },
    { "package.json": { name: "app", dependencies: { foo: "^2" } } },
    (result) => {
      const reached = closure(result);
      expect(reached.purls).toEqual(["pkg:npm/foo@2.0.0"]);
      expect(reached.definite).toEqual([]);
      expect(reached.graph.edges.find((edge) => edge.from === reached.root.node)!.selection).toBe(
        "unknown",
      );
    },
  );
});

test("a reached workspace with an unread manifest cannot produce complete correlated closure", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { ui: "workspace:*" }),
      "ui@workspace:*, ui@workspace:packages/ui": workspace("ui", "packages/ui", { foo: "npm:1" }),
      "foo@npm:1": external("foo"),
    },
    { "package.json": { name: "app", dependencies: { ui: "workspace:*" } } },
    (result) => {
      expect(closure(result).completeness).toBe("unknown");
      expect(closure(result, "package.json", "yarn:dependencies", true).purls).toEqual([
        "pkg:npm/foo@1.0.0",
        "pkg:npm/ui",
      ]);
    },
  );
});

test("Classic transitive dependencies can target a compatible workspace consumer without leaking development tools", async () => {
  await input(
    false,
    {
      "parent@1": { version: "1.0.0", dependencies: { ui: "^2" } },
      "react@19": { version: "19.0.0" },
      "test@1": { version: "1.0.0" },
    },
    {
      "package.json": { name: "app", workspaces: ["packages/*"], dependencies: { parent: "1" } },
      "packages/ui/package.json": {
        name: "ui",
        version: "2.0.0",
        dependencies: { react: "19" },
        devDependencies: { test: "1" },
      },
    },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/parent@1.0.0",
        "pkg:npm/react@19.0.0",
        "pkg:npm/ui@2.0.0",
      ]);
    },
  );
});

test("native Yarn conditions and current workspace platform restrictions remain combined", async () => {
  await input(
    true,
    {
      "app@workspace:.": workspace("app", ".", { ui: "workspace:*" }),
      "ui@workspace:*, ui@workspace:packages/ui": {
        ...workspace("ui", "packages/ui"),
        conditions: "cpu=x64",
      },
    },
    {
      "package.json": { name: "app", dependencies: { ui: "workspace:*" } },
      "packages/ui/package.json": { name: "ui", version: "1.0.0", os: ["linux"] },
    },
    (result) => {
      const reached = closure(result);
      expect(reached.graph.edges.find((edge) => edge.from === reached.root.node)).toMatchObject({
        selection: "conditional",
        condition: {
          language: "yarn:applicability/v1",
          expression: { conditions: "cpu=x64", platform: { os: ["linux"] } },
        },
      });
      expect(reached.definite).toEqual([]);
    },
  );
});
