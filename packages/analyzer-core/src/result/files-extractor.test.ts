import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "vite-plus/test";
import { scanAndMarkFiles } from "../index.ts";
import { filesExtractor } from "./files-extractor.ts";
import { createEmptyResult } from "./merge.ts";
import { queryDependencies } from "./query.ts";
import type { DependencyGraph } from "./types.ts";

const projectPurl = "pkg:generic/example/app";
const extractor = filesExtractor({
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
      ...createEmptyResult(context.codebaseId),
      subprojects: [project],
      packages: [{ purl: dependency, evidence: [`${file}#1`], identityObservations }],
      graphs: [graph],
    };
  },
});

async function inputs(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-files-"));
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
      expect(queryDependencies(result, { graph: graph.id, root: "dependencies" }).definite).toEqual(
        ["1"],
      );
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
    const duplicate = filesExtractor({
      name: "duplicates",
      version: 1,
      markFiles: async function () {
        this.markFile("a/input.txt");
        this.markFile("a/input.txt");
      },
      extractFile: async (_file, _options, context) => createEmptyResult(context.codebaseId),
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
  const invalid = filesExtractor({
    name: "invalid",
    version: 1,
    markFiles: async function () {
      this.markFile("input.txt");
    },
    extractFile: async () => createEmptyResult("different:namespace"),
  });
  const result = await invalid.extract(".", undefined, { codebaseId: "expected:namespace" });
  expect(result.codebase).toBe("expected:namespace");
  expect(result.graphs).toHaveLength(1);
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  expect(result.issues[0]!.message).toContain("different codebase namespace");
});

test("empty discovery still returns a validated result in the caller's namespace", async () => {
  const empty = filesExtractor({
    name: "empty",
    version: 1,
    markFiles: async () => {},
    extractFile: async (_file, _options, context) => createEmptyResult(context.codebaseId),
  });
  expect(await empty.extract(".", undefined, { codebaseId: "example:empty" })).toEqual(
    createEmptyResult("example:empty"),
  );
});

test.skipIf(sep !== "/")(
  "POSIX discovery preserves literal backslashes in directory names",
  async () => {
    const codebase = resolve("directory\\with-backslash");
    let observedRoot: string | undefined;
    const extractor = filesExtractor({
      name: "posix-discovery",
      version: 1,
      markFiles: async (root) => {
        observedRoot = root;
      },
      extractFile: async (_file, _options, context) => createEmptyResult(context.codebaseId),
    });
    await extractor.extract(codebase);
    expect(observedRoot).toBe(codebase);
  },
);

test.skipIf(sep !== "/")(
  "POSIX file assembly preserves distinct literal-backslash project and evidence paths",
  async () => {
    const paths = ["a/b/input.txt", "a\\b/input.txt"];
    const observed: string[] = [];
    const extractor = filesExtractor({
      name: "literal-paths",
      version: 1,
      markFiles: async function () {
        for (const path of paths) this.markFile(path);
      },
      extractFile: async (file, _options, context) => {
        observed.push(context.relativeFile);
        const identityObservations = [
          { source: { extractor: "literal-paths", files: [file] }, synthesizedPurl: false },
        ];
        const project = {
          purl: projectPurl,
          definitionFile: file,
          evidence: [file],
          identityObservations,
        };
        const artifact = { evidence: [file] };
        return {
          ...createEmptyResult(context.codebaseId),
          packages: [
            {
              purl: "pkg:npm/dep@1",
              evidence: [file],
              identityObservations,
              artifacts: [artifact],
            },
          ],
          subprojects: [project],
          graphs: [
            {
              id: "same-native-id",
              source: { extractor: "literal-paths", files: [file] },
              interpretation: "locked",
              rootCompleteness: "complete",
              roots: [
                { id: "root", project, scope: "dependencies", node: "project", evidence: [file] },
              ],
              nodes: [
                {
                  id: "project",
                  purl: projectPurl,
                  project,
                  dependencyCompleteness: "complete",
                  evidence: [file],
                },
                {
                  id: "dep",
                  purl: "pkg:npm/dep@1",
                  dependencyCompleteness: "complete",
                  artifacts: [artifact],
                },
              ],
              edges: [
                {
                  from: "project",
                  to: "dep",
                  status: "resolved",
                  selection: "selected",
                  relation: "depends-on",
                  evidence: [file],
                },
              ],
            },
          ],
          issues: [{ severity: "WARNING", code: "test.path", message: "Path observation", file }],
        };
      },
    });
    const result = await extractor.extract(resolve("owned\\codebase"), undefined, {
      codebaseId: "test:paths",
    });
    expect(observed).toEqual(paths);
    expect(result.subprojects.map((p) => p.definitionFile)).toEqual(paths);
    expect(result.packages[0]!.evidence).toEqual(paths);
    expect(result.packages[0]!.identityObservations!.map((o) => o.source.files[0])).toEqual(paths);
    expect(result.packages[0]!.artifacts!.map((a) => a.evidence[0])).toEqual(paths);
    expect(result.issues.map((issue) => issue.file)).toEqual(paths);
    expect(result.graphs).toHaveLength(2);
    expect(new Set(result.graphs.map((graph) => graph.id)).size).toBe(2);
    for (const graph of result.graphs) {
      const path = graph.source.files[0]!;
      expect(paths).toContain(path);
      expect(JSON.parse(graph.id)).toEqual(["literal-paths", path, "same-native-id"]);
      expect(graph.roots[0]!.project.definitionFile).toBe(path);
      expect(graph.roots[0]!.evidence).toEqual([path]);
      expect(graph.nodes[0]!.artifacts![0]!.evidence).toEqual([path]);
      expect(graph.nodes[1]!.project!.definitionFile).toBe(path);
      expect(graph.nodes[1]!.evidence).toEqual([path]);
      expect(graph.edges[0]!.evidence).toEqual([path]);
      const project = result.subprojects.find((p) => p.definitionFile === path)!;
      expect(project.evidence).toEqual([path]);
      expect(project.identityObservations![0]!.source.files).toEqual([path]);
    }
  },
);

test.skipIf(sep !== "/")(
  "POSIX failures retain distinct literal-backslash input paths",
  async () => {
    const paths = ["a/b/input.txt", "a\\b/input.txt"];
    const extractor = filesExtractor({
      name: "literal-failures",
      version: 1,
      markFiles: async function () {
        for (const path of paths) this.markFile(path);
      },
      extractFile: async () => {
        throw new Error("Unusable input");
      },
    });
    const result = await extractor.extract(".", undefined, { codebaseId: "test:paths" });
    expect(result.issues.map((issue) => issue.file)).toEqual(paths);
    expect(result.graphs).toHaveLength(2);
    expect(new Set(result.graphs.flatMap((graph) => graph.source.files))).toEqual(new Set(paths));
  },
);
