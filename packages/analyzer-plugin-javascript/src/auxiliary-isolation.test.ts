import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import { normalizeResult, queryDependencies, type AnalyzerResult } from "@scatool/analyzer-core";
import {
  bunlockExtractor,
  denoLockExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from "./index.ts";

const project = { name: "app", version: "1.0.0", dependencies: { foo: "^1" } };
const denoLock = {
  version: "5",
  specifiers: { "npm:foo@^1": "1.0.0" },
  npm: { "foo@1.0.0": {} },
  workspace: { dependencies: ["npm:foo@^1"], packageJson: { dependencies: ["npm:foo@^1"] } },
};
const adapters = [
  {
    extractor: packageLockJsonExtractor,
    file: "package-lock.json",
    content: JSON.stringify({
      lockfileVersion: 3,
      packages: { "": project, "node_modules/foo": { version: "1.0.0" } },
    }),
  },
  {
    extractor: pnpmLockExtractor,
    file: "pnpm-lock.yaml",
    content: stringify({
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { foo: { specifier: "^1", version: "1.0.0" } } } },
      packages: { "foo@1.0.0": {} },
      snapshots: { "foo@1.0.0": {} },
    }),
  },
  {
    extractor: bunlockExtractor,
    file: "bun.lock",
    content: JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": project },
      packages: { foo: ["foo@1.0.0", "", {}] },
    }),
  },
  {
    extractor: yarnBerryExtractor,
    file: "yarn.lock",
    content: stringify({
      __metadata: { version: 8 },
      "app@workspace:.": {
        version: "0.0.0-use.local",
        resolution: "app@workspace:.",
        dependencies: { foo: "npm:^1" },
      },
      "foo@npm:^1": { version: "1.0.0", resolution: "foo@npm:1.0.0" },
    }),
  },
  { extractor: yarnLockExtractor, file: "yarn.lock", content: 'foo@^1:\n  version "1.0.0"\n' },
  { extractor: denoLockExtractor, file: "deno.lock", content: JSON.stringify(denoLock) },
];

function retained(result: AnalyzerResult) {
  expect(() => normalizeResult(result)).not.toThrow();
  expect(result.issues.filter((issue) => issue.code === "core.file_extraction_failed")).toEqual([]);
  expect(result.packages.map((pkg) => pkg.purl)).toEqual(["pkg:npm/foo@1.0.0"]);
  expect(result.graphs.some((graph) => graph.interpretation === "locked")).toBe(true);
}

for (const { extractor, file, content } of adapters)
  for (const [stage, manifest] of [
    ["identity", { ...project, name: " " }],
    ["discovery", { ...project, workspaces: 42 }],
    ["declaration", { ...project, dependencies: { "": "^1" } }],
    ["metadata", { ...project, engines: { node: 9007199254740992 } }],
  ] as const)
    test(`${extractor.name}: auxiliary ${stage} failure cannot erase the normalized lock inventory`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "excalibur-auxiliary-isolation-"));
      try {
        await writeFile(join(directory, file), content);
        await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
        const result = await extractor.extract(directory);
        retained(result);
        if (stage !== "discovery" || extractor === yarnLockExtractor)
          expect(result.issues.some((issue) => issue.severity === "WARNING")).toBe(true);
        if (stage === "identity" && extractor === bunlockExtractor) {
          const locked = result.graphs.find((graph) => graph.source.extractor === "bunlock")!;
          expect(locked.roots.every((root) => root.project.purl === "pkg:npm/app@1.0.0")).toBe(
            true,
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

for (const version of ["3", "5"])
  for (const [stage, config] of [
    ["identity", '{"name":" ","imports":{"foo":"npm:foo@^1"}}'],
    ["unsafe metadata", '{"name":"app","workspace":9007199254740992}'],
    ["nonfinite metadata", '{"name":"app","patches":{"foo":1e400}}'],
    ["empty import alias", '{"name":"app","imports":{"":"npm:foo@^1"}}'],
    ["empty scoped alias", '{"name":"app","scopes":{"./tests/":{"":"npm:foo@^1"}}}'],
    [
      "nonstring import after valid import",
      '{"name":"app","imports":{"foo":"npm:foo@^1","bad":42}}',
    ],
  ])
    test(`Deno v${version}: auxiliary config ${stage} is isolated through normalization`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "excalibur-deno-config-isolation-"));
      try {
        const lock =
          version === "3"
            ? {
                version,
                packages: { specifiers: { "npm:foo@^1": "foo@1.0.0" }, npm: { "foo@1.0.0": {} } },
              }
            : denoLock;
        await writeFile(join(directory, "deno.lock"), JSON.stringify(lock));
        await writeFile(join(directory, "deno.json"), config!);
        const result = await denoLockExtractor.extract(directory);
        retained(result);
        expect(result.issues.some((issue) => issue.severity === "WARNING")).toBe(true);
        const declared = result.graphs.find((graph) => graph.interpretation === "declared");
        for (const root of declared?.roots ?? [])
          expect(
            queryDependencies(result, { graph: declared!.id, root: root.id }).completeness,
          ).toBe("unknown");
        const native = result.graphs.find((graph) => graph.source.key === "native-lock")!;
        if (version === "3") expect(native.roots).toEqual([]);
        else
          expect(native.edges.some((edge) => edge.requested?.specifier === "npm:foo@^1")).toBe(
            true,
          );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

test("Classic discovery failure retains already discovered workspaces with uncertain enumeration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-classic-discovery-"));
  try {
    await mkdir(join(directory, "child"));
    await writeFile(join(directory, "yarn.lock"), 'foo@^1:\n  version "1.0.0"\n');
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ ...project, workspaces: { packages: ["child", 42] } }),
    );
    await writeFile(
      join(directory, "child/package.json"),
      JSON.stringify({ name: "child", dependencies: { foo: "^1" } }),
    );
    const result = await yarnLockExtractor.extract(directory);
    retained(result);
    expect(result.issues.some((issue) => issue.code === "yarn.workspace_declarations_failed")).toBe(
      true,
    );
    for (const graph of result.graphs.filter(
      (graph) => graph.attributes?.["yarn:observation"] !== "native-lock",
    )) {
      expect(graph.rootCompleteness).toBe("partial");
      expect(graph.roots.some((root) => root.project.definitionFile === "child/package.json")).toBe(
        true,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
