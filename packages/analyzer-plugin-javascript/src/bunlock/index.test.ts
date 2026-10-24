import { join } from "node:path/posix";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";
import { assertNativeFixture } from "../fixture-assertions.ts";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/bun.lock",
  assertResult: (result, fixture) =>
    assertNativeFixture("bunlock", result, join(fixturesDir, fixture)),
});
