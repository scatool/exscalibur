import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import {
  bunlockExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from "./index.ts";

const root = { name: "app", version: "1.0.0", dependencies: { foo: "^1" } };
const cases = [
  {
    extractor: packageLockJsonExtractor,
    file: "package-lock.json",
    content: JSON.stringify({
      lockfileVersion: 3,
      packages: { "": root, "node_modules/foo": { version: "1.0.0" } },
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
      workspaces: { "": root },
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
  {
    extractor: yarnLockExtractor,
    file: "yarn.lock",
    content: 'foo@^1:\n  version "1.0.0"\n',
  },
];

for (const { extractor, file, content } of cases)
  for (const { invalid, declarations, portable } of [
    { invalid: "non-string request", declarations: { dependencies: { foo: 42 } }, portable: true },
    {
      invalid: "empty dependency name",
      declarations: { dependencies: { "": "^1" } },
      portable: true,
    },
    {
      invalid: "unsafe numeric request",
      declarations: { dependencies: { foo: 9007199254740992 } },
      portable: false,
    },
    {
      invalid: "unsafe peer metadata with malformed request",
      declarations: { dependencies: { foo: 42 }, peerDependenciesMeta: { foo: 9007199254740992 } },
      portable: false,
    },
  ] as const)
    test(`${extractor.name}: ${invalid} does not discard locked inventory`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "excalibur-manifest-isolation-"));
      try {
        await writeFile(join(directory, file), content);
        await writeFile(
          join(directory, "package.json"),
          JSON.stringify({ ...root, ...declarations }),
        );
        const result = await extractor.extract(directory, undefined, {
          codebaseId: "test:isolation",
        });
        validateResult(result);
        expect(
          result.issues.filter((issue) => issue.code === "core.file_extraction_failed"),
        ).toEqual([]);
        expect(result.packages.map((pkg) => pkg.purl)).toContain("pkg:npm/foo@1.0.0");
        expect(result.issues).toContainEqual(
          expect.objectContaining({
            code: portable ? "npm.manifest_declarations_failed" : "npm.manifest_unreadable",
            file: "package.json",
          }),
        );
        const current = result.graphs.find((graph) => graph.interpretation === "declared")!;
        if (portable) {
          const currentRoot = current.roots.find((entry) => entry.scope === "dependencies")!;
          expect(
            queryDependencies(result, { graph: current.id, root: currentRoot.id }).completeness,
          ).toBe("unknown");
          expect(
            current.nodes.find((node) => node.locator !== undefined)?.attributes?.[
              "npm:invalidDeclarations"
            ],
          ).toMatchObject(declarations);
        } else {
          expect(current).toBeUndefined();
          expect(
            result.issues.find((issue) => issue.code === "npm.manifest_unreadable")!.message,
          ).toContain("omitted");
        }
        const locked = result.graphs.find(
          (graph) =>
            graph.source.extractor === extractor.name &&
            graph.attributes?.["yarn:observation"] !== "current-manifest-scopes",
        )!;
        expect(locked.interpretation).toBe("locked");
        if (extractor !== yarnLockExtractor) {
          const lockedRoot = locked.roots.find((entry) =>
            ["dependencies", "yarn:dependencies"].includes(entry.scope),
          )!;
          const closure = queryDependencies(result, { graph: locked.id, root: lockedRoot.id });
          expect(
            closure.definite.map((id) => locked.nodes.find((node) => node.id === id)!.purl),
          ).toContain("pkg:npm/foo@1.0.0");
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

test("Yarn: one invalid workspace declaration leaves other workspace observations usable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-yarn-isolation-"));
  try {
    await mkdir(join(directory, "child"));
    await writeFile(join(directory, "package.json"), JSON.stringify(root));
    await writeFile(
      join(directory, "child/package.json"),
      JSON.stringify({ name: "child", dependencies: { foo: 42 } }),
    );
    await writeFile(
      join(directory, "yarn.lock"),
      stringify({
        __metadata: { version: 8 },
        "app@workspace:.": {
          version: "0.0.0-use.local",
          resolution: "app@workspace:.",
          dependencies: { foo: "npm:^1" },
        },
        "child@workspace:child": {
          version: "0.0.0-use.local",
          resolution: "child@workspace:child",
          dependencies: { foo: "npm:^1" },
        },
        "foo@npm:^1": { version: "1.0.0", resolution: "foo@npm:1.0.0" },
      }),
    );
    const result = await yarnBerryExtractor.extract(directory);
    const graph = result.graphs.find(
      (graph) => graph.attributes?.["yarn:observation"] === "current-manifest-scopes",
    )!;
    expect(graph).toBeDefined();
    for (const file of ["package.json", "child/package.json"]) {
      const entry = graph.roots.find(
        (entry) => entry.project.definitionFile === file && entry.scope === "dependencies",
      )!;
      expect(queryDependencies(result, { graph: graph.id, root: entry.id }).completeness).toBe(
        file === "package.json" ? "complete" : "unknown",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
