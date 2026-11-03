import { join } from "node:path/posix";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";
import { assertNativeFixture } from "../fixture-assertions.ts";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/pnpm-lock.yaml",
  assertResult: (result, fixture) =>
    assertNativeFixture("pnpmlock", result, join(fixturesDir, fixture)),
});
