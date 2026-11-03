import { join } from "node:path";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";
import { test, expect } from "vite-plus/test";
import { PackageURL } from "packageurl-js";
import { extractor } from "./index.ts";

// Native command tests retain pinned recipes and the existing reproducible host/build profile.
// Failures are intentionally not skipped when the tool or registry is unavailable.
const fixturesDir = join(import.meta.dirname, "__fixtures__");
const expected: Record<string, string[]> = {
  basic: ["fmt", "zlib"],
  basic_py: ["cmake", "fmt", "zlib"],
  evidence: ["fmt", "zlib"],
  transitive_extended: ["cmake", "drogon", "spdlog"],
  transitive_simple: ["cmake", "openssl"],
};
for (const fixture of await scanFixtures(fixturesDir, "*/conanfile.{txt,py}")) {
  test(`native Conan graph: ${fixture}`, async () => {
    const result = await extractor.extract(
      join(fixturesDir, fixture),
      {
        profileBuild: join(fixturesDir, "profile"),
        profileHost: join(fixturesDir, "profile"),
      },
      { codebaseId: `fixture:${fixture}` },
    );
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    expect(parseResult(result)).toEqual(result);
    expect(result.graphs).toHaveLength(1);
    const graph = result.graphs[0]!;
    expect(graph.interpretation).toBe("resolved");
    expect(graph.rootCompleteness).toBe("complete");
    expect(graph.roots.map((root) => root.scope).sort()).toEqual(["build", "runtime", "test"]);
    const names = new Set(result.packages.map((pkg) => PackageURL.fromString(pkg.purl).name));
    for (const name of expected[fixture]!) expect(names.has(name), name).toBe(true);
    for (const root of graph.roots) {
      const closure = queryDependencies(result, { graph: graph.id, root: root.id });
      expect(closure.conditional).toEqual([]);
      expect(closure.declarations).toEqual([]);
      expect(closure.completeness).toBe("complete");
    }
    for (const edge of graph.edges) {
      expect(edge.requested?.attributes?.["conan:requirement"]).toMatchObject({ direct: true });
      expect(edge.status).toBe("resolved");
      expect(edge.evidence).toHaveLength(1);
    }
    for (const node of graph.nodes) {
      expect(node.attributes?.["conan:context"]).toMatch(/^(host|build)$/);
      if (!node.project) expect(node.attributes?.["conan:package_id"]).toBeTypeOf("string");
    }
  }, 30000);
}
