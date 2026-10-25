import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { expect, test } from "vite-plus/test";
import { normalizeResult, validateResult } from "@scatool/analyzer-core";
import { ortExtractor } from "./index.ts";
import { convertOrtIdToPurl } from "./id.ts";
import type { OrtAnalyzerResult, OrtResultFile } from "./model.ts";

const fixtures = join(import.meta.dirname, "__fixtures__");
for (const relative of await readdir(fixtures, { recursive: true })) {
  if (!/analyzer-result\.(json|ya?ml)$/.test(relative)) continue;
  test(`native ORT fixture: ${relative}`, async () => {
    const file = join(fixtures, relative);
    const parsed = parseYaml(await readFile(file, "utf8")) as OrtResultFile & OrtAnalyzerResult;
    const native = parsed.analyzer?.result ?? parsed;
    const result = await ortExtractor.extract(dirname(file), {}, { codebaseId: "fixture" });
    validateResult(result);
    expect(
      result.subprojects
        .map((project) => project.definitionFile)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      (native.projects ?? [])
        .map((project) => project.definition_file_path)
        .sort((a, b) => String(a).localeCompare(String(b))),
    );
    for (const pkg of native.packages ?? []) {
      const purl = pkg.purl ?? convertOrtIdToPurl(pkg.id);
      expect(result.packages.some((item) => item.purl === purl)).toBe(true);
    }
    const nativeScopes = Object.values(native.dependency_graphs ?? {}).flatMap((graph) =>
      Object.keys(graph.scopes),
    );
    const observedScopes = result.graphs.flatMap((graph) => graph.roots.map((root) => root.scope));
    for (const scope of nativeScopes)
      expect(observedScopes).toContain(scope.slice(scope.lastIndexOf(":") + 1));
    for (const issue of Object.values(native.issues ?? {}).flat()) {
      expect(
        result.issues.some(
          (item) => item.message === issue.message && item.severity === issue.severity,
        ),
      ).toBe(true);
    }
    expect(result.issues.some((issue) => issue.code === "core.file_extraction_failed")).toBe(false);
    const nativeErrors = Object.values(native.issues ?? {})
      .flat()
      .filter((issue) => issue.severity === "ERROR")
      .map((issue) => issue.message);
    for (const issue of result.issues.filter((issue) => issue.severity === "ERROR"))
      expect(nativeErrors).toContain(issue.message);

    expect(normalizeResult(result)).toMatchSnapshot();
  });
}
