import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

for (const missing of ["importers", "packages"])
  test(`v9 missing ${missing} retains inventory without claiming complete coverage`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "excalibur-pnpm-missing-"));
    try {
      const lock: Record<string, unknown> = {
        lockfileVersion: "9.0",
        importers: { ".": { dependencies: { foo: { specifier: "^1", version: "1.0.0" } } } },
        packages: { "foo@1.0.0": { resolution: { integrity: "sha512-test" } } },
        snapshots: { "foo@1.0.0": {} },
      };
      delete lock[missing];
      await writeFile(join(directory, "pnpm-lock.yaml"), stringify(lock));
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name: "app", dependencies: { foo: "^1" } }),
      );
      const result = await extractorV2.extract(directory);
      validateResultV2(result);
      expect(result.packages.map((pkg) => pkg.purl)).toContain("pkg:npm/foo@1.0.0");
      expect(result.issues.some((issue) => issue.severity === "WARNING")).toBe(true);
      const graph = result.graphs.find((graph) => graph.source.extractor === "pnpmlock")!;
      if (missing === "importers") {
        expect(graph.rootCompleteness).toBe("unknown");
        expect(graph.roots).toEqual([]);
        expect(result.graphs.some((graph) => graph.interpretation === "declared")).toBe(true);
      } else {
        const root = graph.roots.find((entry) => entry.scope === "dependencies")!;
        const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
        expect(closure.completeness).toBe("unknown");
        expect(closure.definite).toEqual([]);
        expect(closure.conditional).toHaveLength(1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
