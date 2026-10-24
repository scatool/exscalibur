import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "vite-plus/test";
import { scanAndMarkFiles } from "../index.ts";
import { filesExtractorV2 } from "./files-extractor.ts";
import { createEmptyResultV2 } from "./merge.ts";
import { queryDependenciesV2 } from "./query.ts";
import type { DependencyGraph } from "./types.ts";

const projectPurl = "pkg:generic/example/app";
const extractor = filesExtractorV2({
  name: "contract-files",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/input.txt", []);
  },
  extractFile: async (file, _options, context) => {
    const version = (await readFile(file, "utf8")).trim();
    if (version === "broken") throw new Error("Broken test input");
    const identityObservations = [
      { source: { extractor: "contract-files", files: [file] }, synthesizedPurl: false },
    ];
    const project = { purl: projectPurl, definitionFile: file, identityObservations };
    const dependency = `pkg:npm/react@${version}`;
    const graph: DependencyGraph = {
      id: "native-graph",
      source: { extractor: "contract-files", files: [file] },
      interpretation: "locked",
      rootCompleteness: "complete",
      roots: [{ id: "dependencies", project, scope: "dependencies", node: "0" }],
      nodes: [
        {
          id: "0",
          purl: projectPurl,
          project,
          dependencyCompleteness: "complete",
          evidence: [file],
        },
        {
          id: "1",
          purl: dependency,
          locator: "opaque-native-locator",
          dependencyCompleteness: "complete",
        },
      ],
      edges: [
        {
          from: "0",
          to: "1",
          status: "resolved",
          selection: "selected",
          relation: "depends-on",
          evidence: [`${file}#1`],
        },
      ],
    };
    return {
      ...createEmptyResultV2(context.codebaseId),
      subprojects: [project],
      packages: [{ purl: dependency, evidence: [`${file}#1`], identityObservations }],
      graphs: [graph],
    };
  },
});

async function inputs(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-v2-files-"));
  try {
    for (const name of ["a", "b"]) await mkdir(join(directory, name));
    await writeFile(join(directory, "a/input.txt"), "18.3.1");
    await writeFile(join(directory, "b/input.txt"), "19.0.0");
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("file assembly namespaces native graph IDs while retaining graph-local node IDs", async () => {
  await inputs(async (directory) => {
    const result = await extractor.extract(directory, undefined, { codebaseId: "example:repo" });
    expect(result.codebase).toBe("example:repo");
    expect(
      result.packages.flatMap((pkg) =>
        pkg.identityObservations!.flatMap((item) => item.source.files),
      ),
    ).toEqual(["a/input.txt", "b/input.txt"]);
    expect(
      result.subprojects.flatMap((project) =>
        project.identityObservations!.flatMap((item) => item.source.files),
      ),
    ).toEqual(["a/input.txt", "b/input.txt"]);
    expect(result.graphs).toHaveLength(2);
    expect(new Set(result.graphs.map((graph) => graph.id)).size).toBe(2);
    expect(result.subprojects.map((project) => project.definitionFile)).toEqual([
      "a/input.txt",
      "b/input.txt",
    ]);
    for (const graph of result.graphs) {
      expect(graph.nodes.map((node) => node.id)).toEqual(["0", "1"]);
      expect(graph.nodes[1]!.locator).toBe("opaque-native-locator");
      expect(
        queryDependenciesV2(result, { graph: graph.id, root: "dependencies" }).definite,
      ).toEqual(["1"]);
      expect(graph.source.files[0]).not.toContain(directory);
    }
    expect(result.packages.flatMap((pkg) => pkg.evidence)).toEqual([
      "a/input.txt#1",
      "b/input.txt#1",
    ]);
  });
});

test("global ignores and duplicate marked inputs do not produce duplicate observations", async () => {
  await inputs(async (directory) => {
    const result = await extractor.extract(directory, undefined, { ignore: ["b/**"] });
    expect(result.graphs).toHaveLength(1);
    expect(result.subprojects[0]!.definitionFile).toBe("a/input.txt");
    const duplicate = filesExtractorV2({
      name: "duplicates",
      version: 1,
      markFiles: async function () {
        this.markFile("a/input.txt");
        this.markFile("a/input.txt");
      },
      extractFile: async (_file, _options, context) => createEmptyResultV2(context.codebaseId),
    });
    expect((await duplicate.extract(directory)).issues).toEqual([]);
  });
});

test("file failures preserve valid independent graphs and use relative diagnostic paths", async () => {
  await inputs(async (directory) => {
    await writeFile(join(directory, "b/input.txt"), "broken");
    const result = await extractor.extract(directory);
    expect(result.graphs.filter((graph) => graph.interpretation === "locked")).toHaveLength(1);
    const failed = result.graphs.find((graph) => graph.interpretation === "unknown")!;
    expect(failed.source.files).toEqual(["b/input.txt"]);
    expect(failed.rootCompleteness).toBe("unknown");
    expect(result.issues).toEqual([
      {
        code: "core.file_extraction_failed",
        severity: "ERROR",
        file: "b/input.txt",
        message: "Failed to extract file: Broken test input",
      },
    ]);
  });
});

test("an extractor cannot silently switch its caller's codebase namespace", async () => {
  const invalid = filesExtractorV2({
    name: "invalid",
    version: 1,
    markFiles: async function () {
      this.markFile("input.txt");
    },
    extractFile: async () => createEmptyResultV2("different:namespace"),
  });
  const result = await invalid.extract(".", undefined, { codebaseId: "expected:namespace" });
  expect(result.codebase).toBe("expected:namespace");
  expect(result.graphs).toHaveLength(1);
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  expect(result.issues[0]!.message).toContain("different codebase namespace");
});

test("empty discovery still returns a validated result in the caller's namespace", async () => {
  const empty = filesExtractorV2({
    name: "empty",
    version: 1,
    markFiles: async () => {},
    extractFile: async (_file, _options, context) => createEmptyResultV2(context.codebaseId),
  });
  expect(await empty.extract(".", undefined, { codebaseId: "example:empty" })).toEqual(
    createEmptyResultV2("example:empty"),
  );
});

test.skipIf(sep !== "/")(
  "POSIX discovery preserves literal backslashes in directory names",
  async () => {
    const codebase = resolve("directory\\with-backslash");
    let observedRoot: string | undefined;
    const extractor = filesExtractorV2({
      name: "posix-discovery",
      version: 1,
      markFiles: async (root) => {
        observedRoot = root;
      },
      extractFile: async (_file, _options, context) => createEmptyResultV2(context.codebaseId),
    });
    await extractor.extract(codebase);
    expect(observedRoot).toBe(codebase);
  },
);
