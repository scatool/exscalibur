import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { normalizeResult, validateResult } from "@scatool/analyzer-core";
import { extractWorkflow } from "./index.ts";

const expected: Record<string, string[]> = {
  basic: ["actions/checkout@v4", "actions/setup-node@v4"],
  conditional: ["actions/cache@v4"],
  "docker-scheme": ["docker://alpine:3.18", "docker://busybox:1.36"],
  "local-and-external": ["./actions/my-local-action", "actions/upload-artifact@v4"],
  matrix: ["actions/checkout@v4", "actions/setup-node@v4"],
  "pinned-commit": ["docker/login-action@ac2bdf35d6ab477ce523b7e564f4b6f3d3af5e6c"],
  "pinned-version": ["actions/setup-python@v5.1.0"],
  "private-action": ["my-org/private-action@v2"],
  "reusable-workflow": [],
  subpath: ["acme/tools/actions/eslint@v1"],
};
const fixtures = join(import.meta.dirname, "__fixtures__");
for (const file of await readdir(fixtures)) {
  test(`native workflow fixture: ${file}`, async () => {
    const result = extractWorkflow(await readFile(join(fixtures, file), "utf8"), file, "fixture");
    validateResult(result);
    const graph = result.graphs[0]!;
    expect(
      graph.edges
        .map((edge) => edge.requested?.specifier)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(expected[file.slice(0, -4)]!.toSorted((a, b) => a.localeCompare(b)));
    expect(graph.edges.every((edge) => edge.status === "declared")).toBe(true);
    expect(result.packages).toEqual([]);
    if (file === "reusable-workflow.yml") {
      expect(graph.nodes[0]!.dependencyCompleteness).toBe("partial");
      expect(result.issues[0]!.code).toBe("INCOMPLETE_WORKFLOW_JOB");
    } else expect(result.issues).toEqual([]);
    if (file === "conditional.yml") expect(graph.edges[0]!.selection).toBe("conditional");

    expect(normalizeResult(result)).toMatchSnapshot();
  });
}
