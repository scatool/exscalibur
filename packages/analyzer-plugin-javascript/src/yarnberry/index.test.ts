import { test, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path/posix";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { extractor } from "./index.ts";
import { validateResult, scanFixtures } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__").replaceAll("\\", "/");
const fixtures = await scanFixtures(fixturesDir, "*/yarn.lock");

// Copy fixtures to /tmp to avoid workspace detection issues
let tmpFixturesDir: string;

beforeAll(() => {
  tmpFixturesDir = mkdtempSync(join(tmpdir().replaceAll("\\", "/"), "yarnberry-test-"));
  cpSync(fixturesDir, tmpFixturesDir, { recursive: true });
});

afterAll(() => {
  if (tmpFixturesDir) {
    rmSync(tmpFixturesDir, { recursive: true, force: true });
  }
});

for (const dir of fixtures) {
  test(dir, async () => {
    const fixturePath = join(tmpFixturesDir, dir);
    const result = await extractor.extract(fixturePath);
    validateResult(result);
    expect(result).toMatchSnapshot();
  });
}
