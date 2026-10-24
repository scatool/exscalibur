import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

for (const escape of ["directory-symlink", "file-symlink", "parent-path"])
  test(`Deno ${escape} keeps lock evidence without reading outside manifests`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "excalibur-deno-containment-"));
    try {
      const codebase = join(directory, "codebase");
      const outside = join(directory, "outside");
      await mkdir(codebase);
      await mkdir(outside);
      const sentinel = "outside-manifest-sentinel";
      await writeFile(
        join(outside, "deno.json"),
        JSON.stringify({
          name: sentinel,
          imports: { hidden: `https://example.invalid/${sentinel}.ts` },
        }),
      );
      await writeFile(
        join(outside, "package.json"),
        JSON.stringify({
          name: sentinel,
          dependencies: { hidden: `https://example.invalid/${sentinel}.tgz` },
        }),
      );
      const member = escape === "parent-path" ? "../outside" : "member";
      if (escape === "directory-symlink") await symlink(outside, join(codebase, member), "dir");
      if (escape === "file-symlink") {
        await mkdir(join(codebase, member));
        for (const file of ["deno.json", "package.json"])
          await symlink(join(outside, file), join(codebase, member, file), "file");
      }
      await writeFile(
        join(codebase, "deno.lock"),
        JSON.stringify({
          version: "5",
          specifiers: { "npm:foo@^1": "1.0.0" },
          npm: { "foo@1.0.0": {} },
          workspace: {
            members: {
              [member]: {
                dependencies: ["npm:foo@^1"],
                packageJson: { dependencies: ["npm:foo@^1"] },
              },
            },
          },
        }),
      );
      const result = await extractorV2.extract(codebase);
      validateResultV2(result);
      expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
      expect(result.issues.some((issue) => issue.code === "deno.manifest_outside_codebase")).toBe(
        true,
      );
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(result.packages.map((pkg) => pkg.purl)).toEqual(["pkg:npm/foo@1.0.0"]);
      const graph = result.graphs.find((graph) => graph.source.key === "native-lock")!;
      const roots = graph.roots.filter((root) =>
        root.project.definitionFile.includes(encodeURIComponent(member)),
      );
      expect(roots).toHaveLength(2);
      for (const root of roots) {
        const closure = queryDependenciesV2(result, { graph: graph.id, root: root.id });
        expect(
          closure.definite.map((id) => graph.nodes.find((node) => node.id === id)!.purl),
        ).toEqual(["pkg:npm/foo@1.0.0"]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
