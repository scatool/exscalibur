import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";

// Expectations read from the committed go.mod files, not generated from extractor output.
const fixtures = {
  basic: { "go.mod": ["github.com/gin-gonic/gin", "github.com/spf13/cobra", "golang.org/x/sync"] },
  monorepo: {
    "go.mod": [
      "example.com/monorepo/pkg1",
      "example.com/monorepo/pkg2",
      "github.com/stretchr/testify",
    ],
    "pkg1/go.mod": ["github.com/google/uuid"],
    "pkg2/go.mod": ["example.com/monorepo/pkg1", "golang.org/x/text"],
  },
  "replace-directive": {
    "go.mod": ["example.com/internal/utils", "github.com/google/uuid"],
    "internal/utils/go.mod": [],
  },
};

for (const [fixture, projects] of Object.entries(fixtures)) {
  test(`native Go extraction: ${fixture}`, async () => {
    const result = await extractor.extract(
      join(import.meta.dirname, "__fixtures__", fixture),
      {},
      { codebaseId: `fixture:${fixture}` },
    );
    validateResultV2(result);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    expect(result.subprojects.map((project) => project.definitionFile).sort()).toEqual(
      Object.keys(projects).sort(),
    );
    for (const [file, requests] of Object.entries(projects)) {
      const graph = result.graphs.find((graph) => graph.source.files.includes(file))!;
      const root = graph.roots.find((root) => root.scope === "dependencies")!;
      const direct = graph.edges.filter((edge) => edge.from === root.node);
      expect(direct.map((edge) => edge.requested?.name ?? "missing request").sort()).toEqual(
        [...requests].sort(),
      );
      expect(
        direct.every((edge) => edge.status === "resolved" && edge.selection === "selected"),
      ).toBe(true);
      const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
      expect(closure.declarations).toEqual([]);
      if (requests.length) expect(closure.completeness).toBe("unknown");
    }
    if (fixture === "replace-directive") {
      expect(
        result.graphs
          .flatMap((graph) => graph.nodes)
          .some((node) =>
            node.artifacts?.some((artifact) => artifact.location === "./internal/utils"),
          ),
      ).toBe(true);
    }
  }, 120000);
}
