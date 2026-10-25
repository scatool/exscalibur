import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyClassicLock } from "@yarnpkg/lockfile";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult, type AnalyzerResult } from "@scatool/analyzer-core";
import { extractor as berry } from "./yarnberry/index.ts";
import { extractor as classic } from "./yarnlock/index.ts";

type NativeRecord = Record<string, unknown>;

async function analyze(
  resolutions: unknown,
  options: {
    modern?: boolean;
    manifest?: string;
    parent?: string;
    leaf?: string;
    reference?: string;
    alternateProductionPath?: boolean;
    optional?: boolean;
    lockVersion?: number;
    patchAlternative?: boolean;
    patchPath?: string;
    patchName?: string;
    aliasTarget?: string;
  } = {},
): Promise<AnalyzerResult> {
  const modern = options.modern ?? true;
  const parent = options.parent ?? "parent";
  const leaf = options.leaf ?? "leaf";
  const reference = options.reference ?? "^1.0.0";
  const directory = await mkdtemp(join(tmpdir(), "excalibur-yarn-resolutions-"));
  const native = (name: string, version: string, more: NativeRecord = {}) => ({
    version,
    ...(modern && { resolution: `${name}@npm:${version}` }),
    ...more,
  });
  const request = modern && !reference.includes(":") ? `npm:${reference}` : reference;
  const leafName = options.aliasTarget ?? leaf;
  const patchPath = options.patchPath ?? `optional!builtin<compat/${leaf}>`;
  const patchName = options.patchName ?? leaf;
  const rootDependencies = {
    [parent]: "^1.0.0",
    ...(options.alternateProductionPath && { holder: "^1.0.0" }),
  };
  const manifest = {
    name: "app",
    dependencies: rootDependencies,
    devDependencies: { holder: "^1.0.0" },
    ...(resolutions !== undefined && { resolutions }),
  };
  const entries = {
    ...(modern && {
      __metadata: { version: options.lockVersion ?? 8 },
      "app@workspace:.": {
        version: "0.0.0-use.local",
        resolution: "app@workspace:.",
        dependencies: { [parent]: "npm:^1.0.0", holder: "npm:^1.0.0" },
      },
    }),
    [`${parent}@${modern ? "npm:" : ""}^1.0.0`]: native(parent, "1.0.0", {
      dependencies: { [leaf]: request },
      ...(options.optional && { dependenciesMeta: { [leaf]: { optional: true } } }),
    }),
    [`holder@${modern ? "npm:" : ""}^1.0.0`]: native("holder", "1.0.0", {
      dependencies: { [leaf]: request },
    }),
    [`${leaf}@${request}`]: native(leafName, "1.0.0", {
      ...(options.optional && { conditions: "os=linux", os: ["linux"] }),
    }),
    [`${leaf}@${modern ? "npm:" : ""}2.0.0`]: native(leafName, "2.0.0"),
    ...(options.patchAlternative && {
      [`${patchName}@patch:${leaf}@npm%3A${reference}#${patchPath}`]: {
        version: "1.0.0",
        resolution: `${patchName}@patch:${leaf}@npm%3A1.0.0#${patchPath}::version=1.0.0&hash=abc123`,
        checksum: "patched-content",
      },
    }),
  };

  try {
    await writeFile(
      join(directory, "yarn.lock"),
      modern ? stringify(entries) : stringifyClassicLock(entries),
    );
    if (options.manifest !== "missing")
      await writeFile(
        join(directory, "package.json"),
        options.manifest ?? JSON.stringify(manifest),
      );

    const result = await (modern ? berry : classic).extract(directory, undefined, {
      codebaseId: "test:yarn-resolutions",
    });
    validateResult(result);
    expect(result.issues.some((issue) => issue.code === "core.file_extraction_failed")).toBe(false);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function query(result: AnalyzerResult, scope = "dependencies") {
  const graph = result.graphs.find(
    (graph) => graph.attributes?.["yarn:observation"] === "current-manifest-scopes",
  )!;
  const root = graph.roots.find((root) => root.scope === scope)!;
  const closure = queryDependencies(result, { graph: graph.id, root: root.id });
  return {
    ...closure,
    definitePurls: closure.definite.map((id) => graph.nodes.find((node) => node.id === id)!.purl),
  };
}

// Native Yarn 4.10.3 Project.preparePackage rewrites parent/leaf to leaf@2 while
// holder/leaf stays at leaf@1. A raw lock projection cannot certify that rewrite,
// but it must not expose the contradicted lookup as a definite effective binding.
test("selective resolutions retain raw candidates without false definite closure", async () => {
  const result = await analyze({ "parent/leaf": "2.0.0" });
  for (const graph of result.graphs.filter((graph) => graph.interpretation === "locked")) {
    const parent = graph.nodes.find((node) => node.locator === "parent@npm:1.0.0")!;
    const holder = graph.nodes.find((node) => node.locator === "holder@npm:1.0.0")!;
    expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
      status: "resolved",
      selection: "unknown",
      requested: { name: "leaf", specifier: "npm:^1.0.0" },
    });
    expect(parent.dependencyCompleteness).toBe("unknown");
    expect(graph.edges.find((edge) => edge.from === holder.id)).toMatchObject({
      selection: "selected",
    });
    expect(holder.dependencyCompleteness).toBe("complete");
  }
  expect(query(result).definitePurls).toEqual(["pkg:npm/parent@1.0.0"]);
  expect(query(result).completeness).toBe("unknown");
  expect(query(result, "devDependencies").definitePurls.sort()).toEqual([
    "pkg:npm/holder@1.0.0",
    "pkg:npm/leaf@1.0.0",
  ]);
  expect(query(result, "devDependencies").completeness).toBe("complete");
});

test("an alternate legitimate path retains membership without hiding unresolved effective adjacency", async () => {
  const result = await analyze({ "parent/leaf": "2.0.0" }, { alternateProductionPath: true });
  expect(query(result).definitePurls).toContain("pkg:npm/leaf@1.0.0");
  expect(query(result).completeness).toBe("unknown");
});

test.each([
  ["parent@1.0.0/leaf@^1.0.0", true],
  ["parent@npm:1.0.0/leaf@npm:^1.0.0", true],
  ["parent@^1.0.0/leaf", false],
  ["parent@2.0.0/leaf", false],
  ["parent/leaf@^1.0.1", false],
  ["other/leaf", false],
  ["parent/other", false],
] as const)(
  "Berry resolution %s uses exact normalized issuer/descriptor matching",
  async (rule, matches) => {
    const result = await analyze({ [rule]: "2.0.0" });
    expect(query(result).definitePurls.includes("pkg:npm/leaf@1.0.0")).toBe(!matches);
    expect(query(result).completeness).toBe(matches ? "unknown" : "complete");
  },
);

test("scoped issuer and dependency identities are matched separately", async () => {
  const result = await analyze(
    { "@scope/parent/@scope/leaf": "2.0.0" },
    { parent: "@scope/parent", leaf: "@scope/leaf" },
  );
  expect(query(result).definitePurls).toEqual(["pkg:npm/%40scope/parent@1.0.0"]);
  expect(query(result, "devDependencies").completeness).toBe("complete");
});

test.each([4, 6, 8, 9])(
  "resolution uncertainty survives supported lock format %s",
  async (lockVersion) => {
    const result = await analyze({ "parent/leaf": "2.0.0" }, { lockVersion });
    expect(query(result).completeness).toBe("unknown");
    expect(query(result).definitePurls).not.toContain("pkg:npm/leaf@1.0.0");
  },
);

test("optional and native platform predicates survive uncertain binding", async () => {
  const result = await analyze({ "parent/leaf": "2.0.0" }, { optional: true });
  const graph = result.graphs.find((graph) => graph.interpretation === "locked")!;
  const parent = graph.nodes.find((node) => node.locator === "parent@npm:1.0.0")!;
  expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
    selection: "unknown",
    optional: true,
    condition: { language: "yarn:applicability/v1", expression: { conditions: "os=linux" } },
  });
});

test.each(["missing", "{broken"])(
  "unavailable root policy %s preserves lock evidence with unknown effective bindings",
  async (manifest) => {
    const result = await analyze(undefined, { manifest });
    const graph = result.graphs.find(
      (graph) => graph.attributes?.["yarn:observation"] === "native-lock",
    )!;
    const parent = graph.nodes.find((node) => node.locator === "parent@npm:1.0.0")!;
    expect(graph.nodes.some((node) => node.purl === "pkg:npm/leaf@1.0.0")).toBe(true);
    expect(graph.edges.find((edge) => edge.from === parent.id)?.selection).toBe("unknown");
    expect(parent.dependencyCompleteness).toBe("unknown");
  },
);

test("Classic ancestor globs do not certify a raw descriptor's effective target", async () => {
  const result = await analyze({ "parent/**/leaf": "2.0.0" }, { modern: false });
  const graph = result.graphs.find(
    (graph) => graph.attributes?.["yarn:observation"] === "native-lock",
  )!;
  const parent = graph.nodes.find((node) => node.locator === "parent@^1.0.0")!;
  expect(graph.edges.find((edge) => edge.from === parent.id)?.selection).toBe("unknown");
  expect(parent.dependencyCompleteness).toBe("unknown");
  // Classic records pool ancestor paths; the absent context is explicitly unknown.
  expect(graph.nodes.find((node) => node.locator === "leaf@2.0.0")?.purl).toBe(
    "pkg:npm/leaf@2.0.0",
  );
});

test("a valid manifest without resolutions retains normal locked certainty", async () => {
  const result = await analyze(undefined);
  expect(query(result).definitePurls).toContain("pkg:npm/leaf@1.0.0");
  expect(query(result).completeness).toBe("complete");
});

test("a retained patch alternative prevents false definite raw binding without tainting unrelated requests", async () => {
  const result = await analyze(undefined, { patchAlternative: true });
  for (const graph of result.graphs.filter((graph) => graph.interpretation === "locked")) {
    const parent = graph.nodes.find((node) => node.locator === "parent@npm:1.0.0")!;
    expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
      selection: "unknown",
      attributes: { "yarn:bindingUncertainty": { reason: "patch-alternative" } },
    });
    expect(parent.dependencyCompleteness).toBe("unknown");
    const root = graph.roots.find(
      (root) =>
        root.scope ===
        (graph.attributes!["yarn:observation"] === "native-lock"
          ? "yarn:dependencies"
          : "dependencies"),
    )!;
    expect(
      graph.edges.find((edge) => edge.from === root.node && edge.requested?.name === "parent")
        ?.selection,
    ).toBe("selected");
    expect(graph.nodes.filter((node) => node.purl === "pkg:npm/leaf@1.0.0")).toHaveLength(2);
  }
  expect(query(result).definitePurls).toEqual(["pkg:npm/parent@1.0.0"]);
  expect(query(result).completeness).toBe("unknown");
});

test("wildcard descriptor ranges use exact descriptor equality rather than broad selector matching", async () => {
  const matched = await analyze({ "parent/leaf@*": "2.0.0" }, { reference: "*" });
  expect(query(matched).completeness).toBe("unknown");
  expect(query(matched, "devDependencies").completeness).toBe("complete");
  const unmatched = await analyze({ "parent/leaf@*": "2.0.0" });
  expect(query(unmatched).completeness).toBe("complete");
});

test.each([null, [], { "parent/leaf": null }, { "a/b/c": "2.0.0" }])(
  "malformed root resolution policy retains native records without assuming effective certainty: %j",
  async (resolutions) => {
    const result = await analyze(resolutions);
    expect(result.packages.some((pkg) => pkg.purl === "pkg:npm/leaf@1.0.0")).toBe(true);
    expect(query(result).completeness).toBe("unknown");
  },
);

test.each([{ patchPath: "./manual.diff" }, { patchName: "patched-leaf" }])(
  "unrelated explicit patch %j does not downgrade ordinary descriptor selection",
  async (options) => {
    const result = await analyze(undefined, { patchAlternative: true, ...options });
    expect(query(result).definitePurls).toContain("pkg:npm/leaf@1.0.0");
    expect(query(result).completeness).toBe("complete");
  },
);

test.each([
  ["parent/alias", "unknown"],
  ["parent/real-leaf", "complete"],
] as const)("resolution %s matches the requested alias identity", async (rule, completeness) => {
  const result = await analyze(
    { [rule]: "2.0.0" },
    {
      leaf: "alias",
      reference: "npm:real-leaf@^1.0.0",
      aliasTarget: "real-leaf",
    },
  );
  expect(query(result).completeness).toBe(completeness);
  expect(query(result).definitePurls.includes("pkg:npm/real-leaf@1.0.0")).toBe(
    completeness === "complete",
  );
});

test("workspace issuer rules affect project roots without changing external issuer bindings", async () => {
  const result = await analyze({ "app@workspace:./parent": "2.0.0" });
  expect(query(result).definitePurls).toEqual([]);
  expect(query(result).completeness).toBe("unknown");
  expect(query(result, "devDependencies").definitePurls).toContain("pkg:npm/leaf@1.0.0");
  expect(query(result, "devDependencies").completeness).toBe("complete");
});

test("unrelated nonportable manifest data does not erase a readable resolution policy", async () => {
  const result = await analyze(undefined, {
    manifest: JSON.stringify({
      name: "app",
      dependencies: { invalid: 9007199254740992 },
      resolutions: { "parent/leaf": "2.0.0" },
    }),
  });
  const graph = result.graphs.find(
    (graph) => graph.attributes?.["yarn:observation"] === "native-lock",
  )!;
  const parent = graph.nodes.find((node) => node.locator === "parent@npm:1.0.0")!;
  const holder = graph.nodes.find((node) => node.locator === "holder@npm:1.0.0")!;
  expect(graph.edges.find((edge) => edge.from === parent.id)).toMatchObject({
    selection: "unknown",
    evidence: ["package.json", "yarn.lock"],
    attributes: { "yarn:bindingUncertainty": { reason: "unapplied-resolution" } },
  });
  expect(graph.edges.find((edge) => edge.from === holder.id)?.selection).toBe("selected");
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "npm.manifest_unreadable" }),
  );
});

test("older Berry compatibility markers retain the same targeted uncertainty", async () => {
  const result = await analyze(undefined, {
    lockVersion: 6,
    patchAlternative: true,
    patchPath: "~builtin<compat/leaf>",
  });
  expect(query(result).definitePurls).toEqual(["pkg:npm/parent@1.0.0"]);
  expect(query(result).completeness).toBe("unknown");
});
