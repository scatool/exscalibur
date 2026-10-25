import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import { extractor } from "./extractor.ts";

for (const fixture of ["basic", "multimodule"]) {
  test(`native Gradle extraction: ${fixture}`, async () => {
    const result = await extractor.extract(
      join(import.meta.dirname, "__fixtures__", fixture),
      {},
      { codebaseId: `fixture:${fixture}` },
    );
    validateResult(result);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    const file = fixture === "basic" ? "build.gradle" : "app/build.gradle";
    const graphFor = (scope: string) =>
      result.graphs.find((graph) =>
        graph.roots.some((root) => root.project.definitionFile === file && root.scope === scope),
      )!;
    const membership = (scope: string) => {
      const graph = graphFor(scope);
      expect(graph).toBeDefined();
      const root = graph.roots[0]!;
      const closure = queryDependencies(result, { graph: graph.id, root: root.id });
      expect(closure.completeness).toBe("unknown");
      expect(graph.attributes).toMatchObject({
        "gradle:projection": "dependency-graph-snapshot",
        "gradle:variantCoverage": "unknown",
      });
      return closure.definite.map((id) => graph.nodes.find((node) => node.id === id)!.purl);
    };
    // Compare committed build.gradle declarations and consumed project transitivity.
    const runtime = membership("runtimeClasspath");
    expect(runtime).toContain("pkg:maven/com.google.guava/guava@31.1-jre");
    expect(runtime).toContain("pkg:maven/org.slf4j/slf4j-api@2.0.7");
    expect(runtime).not.toContain("pkg:maven/junit/junit@4.13.2");
    expect(membership("testRuntimeClasspath")).toContain("pkg:maven/junit/junit@4.13.2");
    if (fixture === "multimodule")
      expect(
        result.subprojects.some((project) => project.definitionFile === "lib/build.gradle"),
      ).toBe(true);
  }, 120000);
}
