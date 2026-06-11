import { join } from "node:path/posix";
import { extractWorkflow } from "./index.ts";
import { createFileContentTests } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

await createFileContentTests({
  extractFn: extractWorkflow,
  fixturesDir,
  pattern: "*.yml",
});
