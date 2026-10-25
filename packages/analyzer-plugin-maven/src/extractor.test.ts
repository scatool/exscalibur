import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  normalizeResult,
  queryDependencies,
  runCommand,
  validateResult,
} from "@scatool/analyzer-core";
import { extractor } from "./extractor.ts";

// Native Maven execution remains required. These expectations come from the fixture POMs.
const fixtures = {
  basic: { "pom.xml": { test: ["pkg:maven/org.junit.jupiter/junit-jupiter-api@6.0.1"] } },
  multimodule: {
    "pom.xml": {},
    "module-a/pom.xml": { compile: ["pkg:maven/com.google.guava/guava@33.0.0-jre"] },
    "module-b/pom.xml": {
      compile: [
        "pkg:maven/com.example/module-a@1.0.0",
        "pkg:maven/org.apache.commons/commons-lang3@3.14.0",
      ],
    },
  },
};
for (const [fixture, projects] of Object.entries(fixtures)) {
  test(`native Maven extraction: ${fixture}`, async () => {
    const directory = join(import.meta.dirname, "__fixtures__", fixture);
    // Extraction is per POM. Install the fixture reactor so module-b resolves module-a
    // without relying on artifacts left behind by earlier runs.
    if (fixture === "multimodule") {
      const preparation = await runCommand(["mvn", "--batch-mode", "-DskipTests", "install"], {
        cwd: directory,
      });
      expect(
        preparation.exitCode,
        [preparation.stderr, preparation.stdout].filter(Boolean).join("\n"),
      ).toBe(0);
    }
    const result = await extractor.extract(directory, {}, { codebaseId: `fixture:${fixture}` });
    validateResult(result);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    expect(result.subprojects.map((project) => project.definitionFile).sort()).toEqual(
      Object.keys(projects).sort(),
    );
    for (const [file, scopes] of Object.entries(projects)) {
      const graph = result.graphs.find((graph) => graph.source.files.includes(file))!;
      for (const [scope, expected] of Object.entries(scopes)) {
        const root = graph.roots.find((root) => root.scope === scope)!;
        const direct = graph.edges
          .filter((edge) => edge.from === root.node)
          .map((edge) =>
            edge.status === "resolved"
              ? graph.nodes.find((node) => node.id === edge.to)!.purl
              : "unresolved",
          );
        expect(direct.sort()).toEqual([...expected].sort());
        // Native tree pruning does not establish complete transitive adjacency.
        expect(queryDependencies(result, { graph: graph.id, root: root.id }).completeness).toBe(
          "unknown",
        );
      }
      const aggregate = graph.roots.find((root) => root.scope === "maven:dependency-tree")!;
      expect(
        queryDependencies(result, { graph: graph.id, root: aggregate.id }).declarations,
      ).toEqual([]);
    }

    expect(normalizeResult(result)).toMatchSnapshot();
  }, 120000);
}
