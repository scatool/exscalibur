import { expect, test } from "vite-plus/test";
import { createEmptyResult, validateResult, type Extractor } from "@scatool/analyzer-core";
import { analyze } from "./analysis.ts";

test("analysis retains discovery failures alongside successful observations", async () => {
  const failure: Extractor = {
    name: "failure",
    version: 1,
    extract: async () => {
      throw new Error("discovery failed");
    },
  };
  const success: Extractor = {
    name: "success",
    version: 1,
    extract: async (_path, _options, runtime) => ({
      ...createEmptyResult(runtime!.codebaseId!),
      packages: [{ purl: "pkg:npm/example@1", evidence: ["input"] }],
    }),
  };
  const result = await analyze("/repo", [failure, success], {}, []);
  validateResult(result);
  expect(result.packages).toHaveLength(1);
  expect(result.issues).toMatchObject([{ code: "cli.extraction_failed", severity: "ERROR" }]);
  expect(result.graphs).toMatchObject([
    { interpretation: "unknown", rootCompleteness: "unknown", roots: [] },
  ]);
});

test("analysis preserves a namespace with no enabled extractors and rejects malformed observations", async () => {
  const empty = await analyze("/repo", [], {}, []);
  validateResult(empty);
  expect(empty.formatVersion).toBe(2);
  const invalid: Extractor = {
    name: "invalid",
    version: 1,
    extract: async () => createEmptyResult("wrong"),
  };
  const result = await analyze("/repo", [invalid], {}, []);
  expect(result.issues[0]!.message).toContain("Cannot merge codebase");
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
});
