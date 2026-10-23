import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { parseResultV2 } from "@scatool/analyzer-core";

// The workspace ready task builds before testing. Run Node directly to catch ESM/CJS
// interoperability failures hidden by the test runner's transformed imports.
test("built CLI runs on Node and emits a validated format 2 result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exscalibur-cli-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: "cli-fixture",
        version: "1.0.0",
        dependencies: { example: "^1" },
      }),
    );
    const output = join(directory, "result.json");
    await promisify(execFile)(process.execPath, [
      join(import.meta.dirname, "../dist/cli.mjs"),
      "--enable",
      "packagejson",
      directory,
      output,
    ]);
    const result = parseResultV2(JSON.parse(await readFile(output, "utf8")));
    expect(result.issues).toEqual([]);
    expect(result.graphs.some((graph) => graph.interpretation === "declared")).toBe(true);
    expect(result.graphs.flatMap((graph) => graph.edges)).toContainEqual(
      expect.objectContaining({
        status: "declared",
        requested: expect.objectContaining({ name: "example", specifier: "^1" }),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
