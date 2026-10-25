import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";

test.each([false, true])(
  "external local source uses its own ancestors (recorded ancestor: %s)",
  async (ancestorRecorded) => {
    const directory = await mkdtemp(join(tmpdir(), "npm-external-source-"));
    try {
      await writeFile(
        join(directory, "package-lock.json"),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { name: "root", dependencies: { local: "file:../outside" } },
            "node_modules/local": { link: true, resolved: "../outside" },
            "../outside": { name: "local", version: "1.0.0", dependencies: { dep: "*" } },
            "node_modules/dep": { version: "2.0.0" },
            ...(ancestorRecorded && { "../node_modules/dep": { version: "1.0.0" } }),
          },
        }),
      );
      const result = await extractor.extract(directory, undefined, { codebaseId: "example:npm" });
      validateResult(result);
      expect(result.issues.some((issue) => issue.code === "npm.manifest_outside_codebase")).toBe(
        true,
      );
      const graph = result.graphs[0]!;
      const local = graph.nodes.find((node) => node.locator === "../outside")!;
      expect(local.purl).toBe("pkg:npm/local@1.0.0");
      const edge = graph.edges.find((entry) => entry.from === local.id)!;
      const root = graph.roots.find(
        (entry) => entry.scope === "dependencies" && entry.project.purl === "pkg:npm/root",
      )!;
      const closure = queryDependencies(result, { graph: graph.id, root: root.id });
      const reached = [...closure.definite, ...closure.conditional].map(
        (id) => graph.nodes.find((node) => node.id === id)!.purl,
      );
      expect(reached).toContain("pkg:npm/local@1.0.0");
      expect(reached).not.toContain("pkg:npm/dep@2.0.0");
      if (ancestorRecorded) {
        expect(edge.status).toBe("resolved");
        expect(reached).toContain("pkg:npm/dep@1.0.0");
        expect(edge.selection).toBe("unknown");
        expect(closure.conditional).toContain(edge.to);
        expect(closure.completeness).toBe("partial");
      } else {
        expect(edge.status).toBe("unresolved");
        expect(edge.to).toBeUndefined();
        expect(closure.completeness).toBe("partial");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
