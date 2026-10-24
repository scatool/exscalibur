import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

test.each(["../outside", "linked"])(
  "lock location %s cannot import a manifest outside the scanned codebase",
  async (location) => {
    const directory = await mkdtemp(join(tmpdir(), "npm-path-boundary-"));
    try {
      const codebase = join(directory, "project");
      const outside = join(directory, "outside");
      await mkdir(codebase);
      await mkdir(outside);
      await writeFile(
        join(outside, "package.json"),
        JSON.stringify({ name: "outside-private-manifest", version: "9.9.9" }),
      );
      if (location === "linked") await symlink(outside, join(codebase, location), "dir");
      await writeFile(
        join(codebase, "package-lock.json"),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { name: "root", version: "1.0.0", dependencies: { local: "file:external" } },
            [location]: { name: "recorded-local", version: "1.0.0" },
            "node_modules/local": { link: true, resolved: location },
          },
        }),
      );
      const result = await extractorV2.extract(codebase, undefined, { codebaseId: "example:npm" });
      validateResultV2(result);
      expect(JSON.stringify(result)).not.toContain("outside-private-manifest");
      expect(result.subprojects.some((pkg) => pkg.purl === "pkg:npm/recorded-local@1.0.0")).toBe(
        true,
      );
      expect(result.issues.some((issue) => issue.code === "npm.manifest_outside_codebase")).toBe(
        true,
      );
      expect(result.graphs.every((graph) => graph.interpretation === "locked")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each([false, true])(
  "contained manifest symlinks remain readable with codebase alias %s",
  async (aliasedCodebase) => {
    const directory = await mkdtemp(join(tmpdir(), "npm-contained-link-"));
    try {
      const realCodebase = join(directory, "project");
      await mkdir(join(realCodebase, "local"), { recursive: true });
      await writeFile(
        join(realCodebase, "package.json"),
        JSON.stringify({
          name: "root",
          version: "1.0.0",
          private: true,
          dependencies: { local: "file:linked" },
        }),
      );
      await writeFile(
        join(realCodebase, "local", "package.json"),
        JSON.stringify({ name: "local", version: "1.0.0", type: "module" }),
      );
      await symlink(join(realCodebase, "local"), join(realCodebase, "linked"), "dir");
      await writeFile(
        join(realCodebase, "package-lock.json"),
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { name: "root", version: "1.0.0", dependencies: { local: "file:linked" } },
            linked: { name: "local", version: "1.0.0" },
            "node_modules/local": { link: true, resolved: "linked" },
          },
        }),
      );
      const codebase = aliasedCodebase ? join(directory, "project-alias") : realCodebase;
      if (aliasedCodebase) await symlink(realCodebase, codebase, "dir");
      const result = await extractorV2.extract(codebase, undefined, {
        codebaseId: "example:contained",
      });
      validateResultV2(result);
      expect(result.issues).toEqual([]);
      expect(result.graphs).toHaveLength(1);
      const graph = result.graphs[0]!;
      expect(
        graph.nodes.find((node) => node.locator === "")?.attributes?.["npm:projectMetadata"],
      ).toMatchObject({ private: true });
      expect(
        graph.nodes.find((node) => node.locator === "linked")?.attributes?.["npm:projectMetadata"],
      ).toMatchObject({ type: "module" });
      expect(result.subprojects.map((project) => project.definitionFile).sort()).toEqual([
        "linked/package.json",
        "package.json",
      ]);
      const root = graph.roots.find(
        (root) => root.project.definitionFile === "package.json" && root.scope === "dependencies",
      )!;
      const edge = graph.edges.find((edge) => edge.from === root.node)!;
      expect(graph.nodes.find((node) => node.id === edge.to)?.locator).toBe("linked");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
