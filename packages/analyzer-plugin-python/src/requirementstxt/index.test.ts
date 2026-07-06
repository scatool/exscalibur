import { join } from "node:path/posix";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { expect, test } from "vitest";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/requirements*.txt",
});

test("skips ansi-highlighted requirements output", async () => {
  const dir = await mkdtemp(joinPath(tmpdir(), "excalibur-requirements-ansi-"));
  await writeFile(joinPath(dir, "requirements.txt"), "\x1B[31mrequests==2.32.0\x1B[0m\n");

  const result = await extractor.extract(dir);

  expect(result.packages).toEqual([]);
  expect(result.subprojects).toEqual([]);
  expect(result.relationships).toEqual([]);
  expect(result.issues).toEqual([]);
});
