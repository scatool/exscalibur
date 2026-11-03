import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";
import { assertNativeNpmLock } from "./acceptance/native-npm-lock.ts";

const cases = [
  {
    id: "ZEISS+angular-styleguide",
    locks: ["package-lock.json"],
    declarations: ["package.json"],
    graphCount: 2,
  },
  { id: "ZEISS+docs-template", locks: ["package-lock.json"], declarations: [], graphCount: 1 },
  {
    id: "ZEISS+playwright-web-scraping",
    locks: ["package-lock.json", "node/package-lock.json"],
    declarations: ["node/package.json"],
    graphCount: 4,
  },
  { id: "ZEISS+precise-ui", locks: ["package-lock.json"], declarations: [], graphCount: 1 },
];
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const sorted = (value: unknown[]) =>
  value.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

for (const config of cases) {
  test(`${config.id}: native placements, requests, declarations and coverage`, () => {
    const source = join(import.meta.dirname, "repositories", config.id);
    const read = (path: string) => JSON.parse(readFileSync(join(source, path), "utf8"));
    const result = parseResult(
      JSON.parse(
        readFileSync(join(import.meta.dirname, "__snapshots__", `${config.id}.json`), "utf8"),
      ),
    );
    expect(result.graphs).toHaveLength(config.graphCount);
    expect(result.issues.map((issue) => [issue.code, issue.file, issue.severity])).toEqual(
      config.declarations.map((file) => ["npm.manifest_lock_mismatch", file, "WARNING"]),
    );
    const nativeCatalog = new Set<string>();
    for (const file of config.locks) {
      const manifestFile = file.replace("package-lock.json", "package.json");
      const matches = result.graphs.filter(
        (graph) =>
          graph.source.extractor === "packagelockjson" && graph.source.files.includes(file),
      );
      expect(matches).toHaveLength(1);
      const graph = matches[0]!;
      expect(graph.source.files).toEqual([file, manifestFile]);
      expect(graph.rootCompleteness).toBe("complete");
      const graphPurls = new Set(
        graph.nodes.filter((node) => !node.project).map((node) => node.purl),
      );
      const manifest = read(manifestFile);
      const lock = read(file);
      const lockedSubject =
        lock.lockfileVersion === 1 ? manifest : { ...lock, ...lock.packages[""] };
      assertNativeNpmLock(
        {
          ...result,
          graphs: [graph],
          packages: result.packages.filter((pkg) => graphPurls.has(pkg.purl)),
        },
        read(file),
        manifest,
        `${config.id}/${file}`,
        manifestFile,
      );
      for (const purl of graphPurls) nativeCatalog.add(purl);
      for (const root of graph.roots) {
        expect(root.project).toEqual({
          purl: `pkg:npm/${lockedSubject.name.replace(/^@/, "%40")}${lockedSubject.version ? `@${lockedSubject.version}` : ""}`,
          definitionFile: manifestFile,
        });
        expect(graph.nodes.find((node) => node.id === root.node)?.project).toEqual(root.project);
      }
    }
    expect(result.packages.map((pkg) => pkg.purl).sort()).toEqual([...nativeCatalog].sort());
    const declared = result.graphs.filter((graph) => graph.source.extractor === "packagejson");
    expect(declared.map((graph) => graph.source.files[0]).sort()).toEqual(
      [...config.declarations].sort(),
    );
    for (const graph of declared) {
      const file = graph.source.files[0]!;
      const manifest = read(file);
      expect(graph.interpretation).toBe("declared");
      expect(graph.rootCompleteness).toBe("complete");
      expect(graph.roots.map((root) => root.scope).sort()).toEqual([...scopes].sort());
      expect(graph.nodes).toHaveLength(5);
      let count = 0;
      for (const root of graph.roots) {
        const requests = Object.entries(manifest[root.scope] ?? {});
        const edges = graph.edges.filter((edge) => edge.from === root.node);
        expect(
          sorted(edges.map((edge) => [edge.requested?.name, edge.requested?.specifier])),
        ).toEqual(sorted(requests));
        count += requests.length;
        for (const edge of edges) {
          expect(edge.status).toBe("declared");
          expect(edge).not.toHaveProperty("to");
          expect(edge.evidence).toEqual([file]);
        }
        const closure = queryDependencies(result, { graph: graph.id, root: root.id });
        expect(closure.definite).toEqual([]);
        expect(closure.conditional).toEqual([]);
        expect(closure.completeness).toBe(requests.length ? "unknown" : "complete");
      }
      expect(graph.edges).toHaveLength(count);
    }
    if (config.id === "ZEISS+playwright-web-scraping") {
      const file = "python/requirements.txt";
      expect(readFileSync(join(source, file), "utf8").trim()).toBe("playwright");
      const graph = result.graphs.find((graph) => graph.source.extractor === "requirementstxt")!;
      expect(graph.source.files).toEqual([file]);
      expect(graph.roots).toHaveLength(1);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        status: "declared",
        requested: { name: "playwright" },
        evidence: [file],
      });
      expect(graph.edges[0]).not.toHaveProperty("to");
      expect(
        queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
      ).toBe("unknown");
    }
  });
}
