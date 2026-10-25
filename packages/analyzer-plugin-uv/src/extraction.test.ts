import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vite-plus/test";
import { runCommand, validateResult } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";
vi.mock("@scatool/analyzer-core", async (original) => ({
  ...(await original<typeof import("@scatool/analyzer-core")>()),
  runCommand: vi.fn(),
}));
async function extract() {
  const dir = await mkdtemp(join(tmpdir(), "uv-export-"));
  try {
    await writeFile(join(dir, "uv.lock"), "version=1");
    return await extractor.extract(dir, { uvPath: "uv-test" }, { codebaseId: "example:uv" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("UV export failure preserves error and unknown observation coverage", async () => {
  vi.mocked(runCommand).mockResolvedValue({ stdout: "", stderr: "failed", exitCode: 3 });
  const result = await extract();
  validateResult(result);
  expect(result.issues[0]).toMatchObject({ code: "uv.export_failed", severity: "ERROR" });
  expect(result.graphs[0]).toMatchObject({
    interpretation: "unknown",
    rootCompleteness: "unknown",
  });
});
test("UV imports native CDX output with explicit export provenance", async () => {
  vi.mocked(runCommand).mockResolvedValue({
    stdout: JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [{ "bom-ref": "child", purl: "pkg:pypi/child@1" }],
    }),
    stderr: "",
    exitCode: 0,
  });
  const result = await extract();
  validateResult(result);
  expect(result.packages[0]!.purl).toBe("pkg:pypi/child@1");
  expect(result.graphs[0]!.source.extractor).toBe("uv");
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
});
