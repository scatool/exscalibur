import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { PackageURL } from "packageurl-js";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractCycloneDX } from "./index.ts";

type Component = { "bom-ref"?: string; purl?: string; components?: Component[] };
const fixtures = join(import.meta.dirname, "__fixtures__");
for (const file of await readdir(fixtures)) {
  test(`native CycloneDX fixture: ${file}`, async () => {
    const content = await readFile(join(fixtures, file), "utf8");
    const source = JSON.parse(content);
    const result = extractCycloneDX(content, { evidenceFile: file, codebase: "fixture" });
    validateResultV2(result);
    const graph = result.graphs[0]!;
    const components: Component[] = [];
    const visit = (values: Component[]) => {
      for (const value of values) {
        components.push(value);
        visit(value.components ?? []);
      }
    };
    visit(source.components ?? []);
    if (source.metadata?.component) visit([source.metadata.component]);
    for (const component of components) {
      if (component["bom-ref"])
        expect(graph.nodes.some((node) => node.locator === component["bom-ref"])).toBe(true);
      if (component.purl) {
        let purl: string;
        try {
          purl = PackageURL.fromString(component.purl).toString();
        } catch {
          continue;
        }
        expect(result.packages.some((pkg) => pkg.purl === purl)).toBe(true);
      }
    }
    const byId = new Map(graph.nodes.map((node) => [node.id, node.locator]));
    const observed = graph.edges.map((edge) => [
      byId.get(edge.from),
      edge.status === "resolved" ? byId.get(edge.to) : null,
    ]);
    const expected: string[][] = (source.dependencies ?? []).flatMap(
      (dep: { ref: string; dependsOn?: string[] }) =>
        (dep.dependsOn ?? []).map((target) => [dep.ref, target]),
    );
    expect(observed.sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      expected.sort((a, b) => String(a).localeCompare(String(b))),
    );
    for (const dep of source.dependencies ?? [])
      expect(graph.nodes.find((node) => node.locator === dep.ref)!.dependencyCompleteness).toBe(
        "complete",
      );
    if (!source.dependencies)
      expect(graph.nodes.every((node) => node.dependencyCompleteness === "unknown")).toBe(true);
  });
}

test("default converter retains distribution and source references from the basic native fixture", async () => {
  const result = extractCycloneDX(await readFile(join(fixtures, "basic.cdx.json"), "utf8"), {
    evidenceFile: "basic.cdx.json",
    codebase: "fixture",
  });
  const express = result.packages.find((pkg) => pkg.purl === "pkg:npm/express@4.18.2")!;
  expect(express.artifacts).toContainEqual({
    location: "https://registry.npmjs.org/express/-/express-4.18.2.tgz",
    evidence: ["basic.cdx.json"],
  });
  expect(express.externalReferences).toEqual(
    expect.arrayContaining([
      {
        type: "sourceArtifact",
        locator: "https://github.com/expressjs/express/archive/refs/tags/4.18.2.tar.gz",
      },
      { type: "vcs", locator: "git+https://github.com/expressjs/express.git@4.18.2" },
    ]),
  );
  expect(express.externalReferences).toHaveLength(2);
});
