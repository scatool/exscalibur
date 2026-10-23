import { join } from "node:path/posix";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";
import { assertNativeFixture } from "../fixture-assertions.ts";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/package.json",
  assertResult: (result, fixture) =>
    assertNativeFixture("packagejson", result, join(fixturesDir, fixture)),
});
