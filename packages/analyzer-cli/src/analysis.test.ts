import { expect, test } from "vite-plus/test";
import { createEmptyResultV2, validateResultV2, type ExtractorV2 } from "@scatool/analyzer-core";
import { analyze } from "./analysis.ts";

test("analysis retains discovery failures alongside successful observations", async () => {
  const failure: ExtractorV2 = {
    name: "failure",
    version: 1,
    extract: async () => {
      throw new Error("discovery failed");
    },
  };
  const success: ExtractorV2 = {
    name: "success",
    version: 1,
    extract: async (_path, _options, runtime) => ({
      ...createEmptyResultV2(runtime!.codebaseId!),
      packages: [{ purl: "pkg:npm/example@1", evidence: ["input"] }],
    }),
  };
  const result = await analyze("/repo", [failure, success], {}, []);
  validateResultV2(result);
  expect(result.packages).toHaveLength(1);
  expect(result.issues).toMatchObject([{ code: "cli.extraction_failed", severity: "ERROR" }]);
  expect(result.graphs).toMatchObject([
    { interpretation: "unknown", rootCompleteness: "unknown", roots: [] },
  ]);
});

test("analysis preserves a namespace with no enabled extractors and rejects malformed observations", async () => {
  const empty = await analyze("/repo", [], {}, []);
  validateResultV2(empty);
  expect(empty.formatVersion).toBe(2);
  const invalid: ExtractorV2 = {
    name: "invalid",
    version: 1,
    extract: async () => createEmptyResultV2("wrong"),
  };
  const result = await analyze("/repo", [invalid], {}, []);
  expect(result.issues[0]!.message).toContain("Cannot merge codebase");
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
});
