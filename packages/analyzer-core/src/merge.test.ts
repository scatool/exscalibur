import { test, expect } from "vite-plus/test";
import { createEmptyResult, mergeResults, type AnalyzerResult } from "./index.ts";

const result = (evidence: string[]): AnalyzerResult => ({
  ...createEmptyResult("example:repo"),
  packages: [{ purl: "pkg:npm/foo@1", evidence }],
});

test("public merge API uses only the contextual result contract", () => {
  expect(mergeResults([result(["b", "a"]), result(["c", "a"])]).packages).toEqual([
    { purl: "pkg:npm/foo@1", evidence: ["a", "b", "c"] },
  ]);
});

test("merge retains external references and independent artifacts instead of a first-wins download", () => {
  const a = result(["a"]);
  const b = result(["b"]);
  a.packages[0]!.externalReferences = [{ type: "vcs", locator: "https://example.com/repo" }];
  b.packages[0]!.externalReferences = [
    { type: "vcs", locator: "https://example.com/repo" },
    { type: "sourceArtifact", locator: "https://example.com/source" },
  ];
  a.packages[0]!.artifacts = [{ location: "https://example.com/linux", evidence: ["a"] }];
  b.packages[0]!.artifacts = [{ location: "https://example.com/windows", evidence: ["b"] }];
  const merged = mergeResults([a, b]);
  expect(merged.packages[0]!.artifacts).toHaveLength(2);
  expect(merged.packages[0]!.externalReferences).toHaveLength(2);
  expect(mergeResults([b, a])).toEqual(merged);
});

test("public merge retains projects with the same PURL in different files", () => {
  const a = result([]);
  const b = result([]);
  a.subprojects = [{ purl: "pkg:npm/app", definitionFile: "a/package.json" }];
  b.subprojects = [{ purl: "pkg:npm/app", definitionFile: "b/package.json" }];
  expect(mergeResults([a, b]).subprojects).toHaveLength(2);
});

test("empty merge requires its namespace and legacy shapes are rejected", () => {
  expect(() => mergeResults([])).toThrow("codebase");
  expect(mergeResults([], { codebase: "example:repo" })).toEqual(createEmptyResult("example:repo"));
  expect(() =>
    mergeResults([
      { packages: [], subprojects: [], relationships: [], issues: [] } as unknown as AnalyzerResult,
    ]),
  ).toThrow();
});
