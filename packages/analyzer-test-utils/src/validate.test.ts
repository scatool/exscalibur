import { test, expect } from "vitest";
import { createEmptyResult, type AnalyzerResult } from "@scatool/analyzer-core";
import { assertSuccessfulResult, validateResult } from "./validate.ts";

const empty = () => createEmptyResult("test:fixture");

test("validation accepts matching catalog/project PURLs with exact project identity", () => {
  const result = empty();
  result.packages = [{ purl: "pkg:npm/app", evidence: [] }];
  result.subprojects = [
    { purl: "pkg:npm/app", definitionFile: "a/package.json" },
    { purl: "pkg:npm/app", definitionFile: "b/package.json" },
  ];
  expect(() => validateResult(result)).not.toThrow();
  result.subprojects.push({ ...result.subprojects[0]! });
  expect(() => validateResult(result)).toThrow("Duplicate project");
});

test("validation rejects duplicated package identities, malformed issues and dangling views", () => {
  const result = empty();
  result.packages = [
    { purl: "pkg:npm/foo", evidence: [] },
    { purl: "pkg:npm/foo", evidence: [] },
  ];
  expect(() => validateResult(result)).toThrow("Duplicate package");
  const invalidIssue = {
    ...empty(),
    issues: [{ message: "failed", severity: "ERROR" }],
  } as unknown as AnalyzerResult;
  expect(() => validateResult(invalidIssue)).toThrow();
  const dangling = empty();
  dangling.graphs = [
    {
      id: "g",
      source: { extractor: "test", files: [] },
      interpretation: "unknown",
      rootCompleteness: "unknown",
      roots: [],
      nodes: [{ id: "n", purl: "pkg:npm/absent", dependencyCompleteness: "unknown" }],
      edges: [],
    },
  ];
  expect(() => validateResult(dangling)).toThrow("unknown package");
});

test("valid failure observations cannot silently pass successful fixture checks", () => {
  const result = empty();
  result.issues.push({ code: "fixture.failure", message: "unavailable input", severity: "ERROR" });
  validateResult(result);
  expect(() => assertSuccessfulResult(result)).toThrow("fixture.failure");
  expect(() => assertSuccessfulResult(result, ["fixture.failure"])).not.toThrow();
  result.issues.push({ code: "unexpected", message: "another failure", severity: "ERROR" });
  expect(() => assertSuccessfulResult(result, ["fixture.failure"])).toThrow("unexpected");
});

test("legacy relationship-only results are no longer accepted", () => {
  expect(() =>
    validateResult({
      packages: [],
      subprojects: [],
      relationships: [],
      issues: [],
    } as unknown as AnalyzerResult),
  ).toThrow();
});
