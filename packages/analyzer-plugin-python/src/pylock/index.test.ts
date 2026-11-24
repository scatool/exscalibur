import { join } from "node:path/posix";
import { expect, test } from "vite-plus/test";
import type { AnalyzerResult } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/{pylock.toml,pylock.*.toml}",
});

function expectDevLockfileIgnored(result: AnalyzerResult): void {
  const scopes = result.subprojects.flatMap((subproject) => subproject.scopes.map((s) => s.scope));
  expect(scopes).toContain("env.default");
  expect(scopes).not.toContain("env.dev");
  const evidence = result.packages.flatMap((pkg) => pkg.evidence);
  expect(evidence.length).toBeGreaterThan(0);
  expect(evidence.some((entry) => entry.includes("pylock.dev.toml"))).toBe(false);
}

test("sibling lockfiles excluded by runtime ignore patterns are not read", async () => {
  const result = await extractor.extract(join(fixturesDir, "multiple-envs"), undefined, {
    ignore: ["**/pylock.dev.toml"],
  });
  expectDevLockfileIgnored(result);
});

test("sibling lockfiles excluded by codebase-relative ignore patterns are not read", async () => {
  const result = await extractor.extract(fixturesDir, {
    ignore: ["multiple-envs/pylock.dev.toml"],
  });
  expectDevLockfileIgnored(result);
});
