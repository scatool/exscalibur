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

type RecordValue = Record<string, unknown>;
async function input(
  lock: RecordValue,
  manifests: Record<string, RecordValue | string>,
  run: (result: AnalyzerResultV2) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-deno-v2-"));
  try {
    await writeFile(join(directory, "deno.lock"), JSON.stringify(lock));
    for (const [file, manifest] of Object.entries(manifests)) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await writeFile(
        join(directory, file),
        typeof manifest === "string" ? manifest : JSON.stringify(manifest),
      );
    }
    const result = await extractorV2.extract(directory, undefined, { codebaseId: "example:deno" });
    validateResultV2(result);
    expect(result.issues.filter((issue) => issue.code === "core.file_extraction_failed")).toEqual(
      [],
    );
    run(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function closure(result: AnalyzerResultV2, file = "deno.json", scope = "deno:dependencies") {
  const graph = result.graphs.find((graph) => graph.source.key === "native-lock")!;
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
  ].sort();
  return { ...closure, graph, root, purls };
}
const app = { name: "app", version: "1.0.0" };

test("v3 maps retain native aliases without inventing project ownership from specifiers", async () => {
  await input(
    {
      version: "3",
      packages: {
        specifiers: { "npm:parent@^1": "npm:parent@1.0.0" },
        npm: {
          "parent@1.0.0": { dependencies: { alias: "@scope/child@2.0.0" } },
          "@scope/child@2.0.0": {},
        },
      },
    },
    { "deno.json": { ...app, imports: { parent: "npm:parent@^1" } } },
    (result) => {
      const graph = result.graphs.find((graph) => graph.source.key === "native-lock")!;
      expect(graph.roots).toEqual([]);
      expect(graph.rootCompleteness).toBe("unknown");
      const binding = graph.edges[0]!;
      expect(binding.requested).toEqual({ name: "alias" });
      expect(
        binding.status === "resolved" && graph.nodes.find((node) => node.id === binding.to)!.purl,
      ).toBe("pkg:npm/%40scope/child@2.0.0");
      expect(graph.attributes?.["deno:specifiers"]).toEqual({
        "npm:parent@^1": "npm:parent@1.0.0",
      });
    },
  );
});

test.each(["4", "5"])(
  "v%s full npm IDs preserve peer contexts with equal PURLs",
  async (version) => {
    await input(
      {
        version,
        specifiers: { "npm:left@1": "1.0.0", "npm:right@1": "1.0.0" },
        npm: {
          "left@1.0.0": { dependencies: ["widget@1.0.0_react@18.3.1"] },
          "right@1.0.0": { dependencies: ["widget@1.0.0_react@19.0.0"] },
          "widget@1.0.0_react@18.3.1": { dependencies: ["react@18.3.1"] },
          "widget@1.0.0_react@19.0.0": { dependencies: ["react@19.0.0"] },
          "react@18.3.1": {},
          "react@19.0.0": {},
        },
        workspace: { dependencies: ["npm:left@1"], packageJson: { dependencies: ["npm:right@1"] } },
      },
      {
        "deno.json": app,
        "package.json": { ...app, devDependencies: { right: "1" } },
      },
      (result) => {
        expect(closure(result).purls).toEqual([
          "pkg:npm/left@1.0.0",
          "pkg:npm/react@18.3.1",
          "pkg:npm/widget@1.0.0",
        ]);
        expect(closure(result, "package.json", "packageJson:dependencies").purls).toEqual([
          "pkg:npm/react@19.0.0",
          "pkg:npm/right@1.0.0",
          "pkg:npm/widget@1.0.0",
        ]);
        expect(
          closure(result).graph.nodes.filter((node) => node.purl === "pkg:npm/widget@1.0.0"),
        ).toHaveLength(2);
        expect(
          closure(result)
            .graph.edges.filter((edge) => edge.kind === "dependencies")
            .every((edge) => edge.optional === undefined),
        ).toBe(true);
      },
    );
  },
);

test("JSR shorthand requirements resolve through the unique specifier and retain unknown coverage", async () => {
  await input(
    {
      version: "5",
      specifiers: { "jsr:@scope/parent@^1": "1.0.0", "npm:child@^2": "2.0.0" },
      jsr: {
        "@scope/parent@1.0.0": { integrity: "native-hash", dependencies: ["npm:child"] },
      },
      npm: { "child@2.0.0": {} },
      workspace: { dependencies: ["jsr:@scope/parent@^1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:jsr/%40scope/parent@1.0.0",
        "pkg:npm/child@2.0.0",
      ]);
      expect(closure(result).completeness).toBe("unknown");
      expect(
        closure(result).graph.nodes.find((node) => node.purl.startsWith("pkg:jsr/"))!
          .dependencyCompleteness,
      ).toBe("unknown");
    },
  );
});

test("duplicated optional-peer bindings become one optional peer edge", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { dependencies: ["react"], optionalPeers: ["react"] },
        "react@18.3.1": {},
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      const graph = closure(result).graph;
      const parent = graph.nodes.find((node) => node.purl === "pkg:npm/parent@1.0.0")!;
      expect(graph.edges.filter((edge) => edge.from === parent.id)).toHaveLength(1);
      expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
        status: "resolved",
        kind: "peerDependencies",
        optional: true,
      });
    },
  );
});

test("migrated optional-peer ranges remain declarations without fabricated range PURLs", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { optionalPeers: ["react@^18"] },
        "react@19.0.0": {},
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/parent@1.0.0"]);
      expect(closure(result).declarations[0]!.dependency).toMatchObject({
        status: "declared",
        kind: "peerDependencies",
        optional: true,
        requested: { name: "react", specifier: "^18" },
      });
      expect(
        result.packages.some((pkg) => PackageURL.fromString(pkg.purl).version?.includes("^")),
      ).toBe(false);
    },
  );
});

test("a migrated peer range can annotate its matching recorded binding without a second mandatory edge", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { dependencies: ["react@18.3.1"], optionalPeers: ["react@^18"] },
        "react@18.3.1": {},
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      const graph = closure(result).graph;
      const parent = graph.nodes.find((node) => node.purl === "pkg:npm/parent@1.0.0")!;
      const bindings = graph.edges.filter((edge) => edge.from === parent.id);
      expect(bindings).toHaveLength(1);
      expect(bindings[0]).toMatchObject({
        optional: true,
        kind: "peerDependencies",
        requested: { specifier: "^18" },
      });
    },
  );
});

test("ambiguous abbreviated npm names never select an arbitrary peer instance", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { dependencies: ["widget"] },
        "widget@1.0.0_react@18": {},
        "widget@1.0.0_react@19": {},
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/parent@1.0.0"]);
      expect(result.issues.some((issue) => issue.code === "deno.ambiguous_dependency")).toBe(true);
      expect(closure(result).completeness).toBe("partial");
    },
  );
});

test("npm alias arrays preserve installation names separately from actual package identity", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { dependencies: ["old@npm:@scope/actual@2.0.0"] },
        "@scope/actual@2.0.0": {},
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/%40scope/actual@2.0.0",
        "pkg:npm/parent@1.0.0",
      ]);
      expect(
        closure(result).graph.edges.find((edge) => edge.requested?.name === "old")!.requested,
      ).toEqual({ name: "old" });
    },
  );
});

test("npm omitted dependency fields are leaves while JSR records retain unknown adjacency", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:leaf@1": "1.0.0", "jsr:@scope/leaf@1": "1.0.0" },
      npm: { "leaf@1.0.0": {} },
      jsr: { "@scope/leaf@1.0.0": {} },
      workspace: { dependencies: ["npm:leaf@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).completeness).toBe("complete");
      expect(
        closure(result).graph.nodes.find((node) => node.purl.startsWith("pkg:jsr/"))!
          .dependencyCompleteness,
      ).toBe("unknown");
    },
  );
});

test("remote checksums and redirects do not invent module dependency edges or project ownership", async () => {
  await input(
    {
      version: "5",
      remote: { "https://example.com/mod.ts": "a".repeat(64) },
      redirects: { "https://example.com/alias": "https://example.com/mod.ts" },
    },
    {
      "deno.json": { ...app, imports: { remote: "https://example.com/alias" } },
    },
    (result) => {
      const native = result.graphs.find((graph) => graph.source.key === "native-lock")!;
      expect(native.edges).toEqual([]);
      expect(native.roots).toEqual([]);
      expect(native.nodes[0]!.dependencyCompleteness).toBe("unknown");
      expect(result.packages[0]!.purl).toMatch(/^pkg:generic\//);
      expect(result.packages[0]!.artifacts?.[0]?.location).toBe("https://example.com/mod.ts");
      expect(
        result.graphs.find((graph) => graph.source.key === "current-config-declarations")!.edges[0],
      ).toMatchObject({
        status: "declared",
        requested: { specifier: "https://example.com/alias" },
      });
    },
  );
});

test("native workspace members with identical coordinates retain exact ownership", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:one@1": "1.0.0", "npm:two@1": "1.0.0" },
      npm: { "one@1.0.0": {}, "two@1.0.0": {} },
      workspace: {
        members: { a: { dependencies: ["npm:one@1"] }, b: { dependencies: ["npm:two@1"] } },
      },
    },
    { "deno.json": app, "a/deno.json": app, "b/deno.json": app },
    (result) => {
      expect(closure(result, "a/deno.json").purls).toEqual(["pkg:npm/one@1.0.0"]);
      expect(closure(result, "b/deno.json").purls).toEqual(["pkg:npm/two@1.0.0"]);
    },
  );
});

test("native platform alternatives remain inventory and scope members with conditional applicability", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { optionalDependencies: ["linux@1.0.0", "windows@1.0.0"] },
        "linux@1.0.0": { os: ["linux"], cpu: ["x64"] },
        "windows@1.0.0": { os: ["win32"] },
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual([
        "pkg:npm/linux@1.0.0",
        "pkg:npm/parent@1.0.0",
        "pkg:npm/windows@1.0.0",
      ]);
      expect(closure(result).definite).toHaveLength(1);
      expect(result.packages).toHaveLength(3);
    },
  );
});

test("current JSONC import scopes are declarations and invalid current declarations do not erase native locks", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:foo@1": "1.0.0" },
      npm: { "foo@1.0.0": {} },
      workspace: { dependencies: ["npm:foo@1"] },
    },
    {
      "deno.jsonc":
        '{ // comment\n "name": "app", "imports": { "foo": "npm:foo@^2" }, "scopes": { "./tests/": { "foo": "npm:foo@^3" } }, }',
    },
    (result) => {
      expect(closure(result, "deno.jsonc").purls).toEqual(["pkg:npm/foo@1.0.0"]);
      const declarations = result.graphs.find(
        (graph) => graph.source.key === "current-config-declarations",
      )!;
      expect(declarations.edges.every((edge) => edge.status === "declared")).toBe(true);
      expect(
        declarations.edges.find((edge) => edge.requested?.specifier === "npm:foo@^3"),
      ).toMatchObject({
        selection: "conditional",
        condition: { language: "deno:import-scope/v1" },
      });
    },
  );
  await input(
    {
      version: "5",
      specifiers: { "npm:foo@1": "1.0.0" },
      npm: { "foo@1.0.0": {} },
      workspace: { dependencies: ["npm:foo@1"] },
    },
    {
      "deno.json": { name: "app", imports: { invalid: 42 } },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0"]);
      expect(result.issues.some((issue) => issue.code === "deno.config_declarations_failed")).toBe(
        true,
      );
    },
  );
});

test("all existing Deno fixture formats keep valid identities and references", async () => {
  const fixtures = join(import.meta.dirname, "__fixtures__");
  for (const name of await scanFixtures(fixtures, "*/deno.lock")) {
    const result = await extractorV2.extract(join(fixtures, name));
    expect(
      result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
      name,
    ).toEqual([]);
    validateResultV2(result);
    expect(result.packages.length, name).toBeGreaterThan(0);
  }
});

test("an exact optional-peer requirement does not fabricate an absent resolved package", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:parent@1": "1.0.0" },
      npm: {
        "parent@1.0.0": { optionalPeers: ["react@18.3.1"] },
      },
      workspace: { dependencies: ["npm:parent@1"] },
    },
    { "deno.json": app },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/parent@1.0.0"]);
      expect(result.packages).toHaveLength(1);
      expect(closure(result).declarations[0]!.dependency).toMatchObject({
        status: "declared",
        optional: true,
        selection: "unknown",
        requested: { specifier: "18.3.1" },
      });
    },
  );
});

test.each([false, true])(
  "exact peer requirements overlay the recorded context even with unrelated base inventory (%s)",
  async (basePresent) => {
    await input(
      {
        version: "5",
        specifiers: { "npm:parent@1": "1.0.0" },
        npm: {
          "parent@1.0.0": {
            dependencies: ["react@18.3.1_other@1.0.0"],
            optionalPeers: ["react@18.3.1"],
          },
          "react@18.3.1_other@1.0.0": {},
          ...(basePresent && { "react@18.3.1": {} }),
        },
        workspace: { dependencies: ["npm:parent@1"] },
      },
      { "deno.json": app },
      (result) => {
        const graph = closure(result).graph;
        const parent = graph.nodes.find((node) => node.purl === "pkg:npm/parent@1.0.0")!;
        expect(graph.edges.filter((edge) => edge.from === parent.id)).toHaveLength(1);
        const target = graph.nodes.find((node) => node.locator === "react@18.3.1_other@1.0.0")!;
        expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
          optional: true,
          kind: "peerDependencies",
          requested: { specifier: "18.3.1" },
          to: target.id,
        });
        expect(result.packages).toHaveLength(2);
        expect(graph.nodes.some((node) => node.locator === "react@18.3.1")).toBe(basePresent);
      },
    );
  },
);

test("malformed current workspace discovery does not erase native members or resolution", async () => {
  await input(
    {
      version: "5",
      specifiers: { "npm:foo@1": "1.0.0" },
      npm: { "foo@1.0.0": {} },
      workspace: { dependencies: ["npm:foo@1"] },
    },
    {
      "deno.json": { ...app, workspace: 42 },
    },
    (result) => {
      expect(closure(result).purls).toEqual(["pkg:npm/foo@1.0.0"]);
      expect(
        result.issues.some((issue) => issue.code === "deno.workspace_declarations_failed"),
      ).toBe(true);
      expect(
        result.graphs.find((graph) => graph.source.key === "current-config-declarations")!
          .rootCompleteness,
      ).toBe("partial");
    },
  );
});
