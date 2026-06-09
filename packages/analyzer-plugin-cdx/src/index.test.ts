import { join } from "node:path/posix";
import { extractCycloneDX } from "./index.ts";
import { createFileContentTests } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

await createFileContentTests({
  extractFn: extractCycloneDX,
  fixturesDir,
  pattern: "*.cdx.json",
});
