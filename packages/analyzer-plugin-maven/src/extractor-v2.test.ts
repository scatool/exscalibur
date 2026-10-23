import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import { convertMavenTreeV2, extractor } from "./extractor-v2.ts";

const node = (artifactId: string) => ({ groupId: "org.example", artifactId, version: "1" });
test("Maven tree occurrences retain different exclusions and classified artifact identities", () => {
  const result = convertMavenTreeV2(
    {
      ...node("app"),
      children: [
        {
          ...node("shared"),
          scope: "compile",
          children: [{ ...node("a"), classifier: "tests", type: "test-jar" }],
        },
        { ...node("shared"), scope: "test", children: [{ ...node("b"), optional: "true" }] },
      ],
    },
    "pom.xml",
    "test",
  );
  validateResultV2(result);
  const graph = result.graphs[0]!;
  const closure = (root: string) => queryDependenciesV2(result, { graph: graph.id, root });
  expect(closure("root:compile").definite).toEqual(["tree/0", "tree/0/0"]);
  expect(closure("root:test").definite).toEqual(["tree/1", "tree/1/0"]);
  expect(
    result.packages.some(
      (pkg) => pkg.purl.includes("classifier=tests") && pkg.purl.includes("type=test-jar"),
    ),
  ).toBe(true);
  expect(graph.edges.find((edge) => edge.from === "tree/1")).toMatchObject({ optional: true });
  expect(graph.edges.every((edge) => !edge.requested)).toBe(true);
});

test("Maven successful empty dependency tree retains a known empty project root", () => {
  const result = convertMavenTreeV2(node("app"), "pom.xml", "test");
  expect(
    queryDependenciesV2(result, {
      graph: result.graphs[0]!.id,
      root: "root:maven:dependency-tree",
    }),
  ).toMatchObject({ definite: [], completeness: "complete" });
});

test.each([
  { stdout: "[ERROR] Cannot resolve dependency plugin\n", stderr: "" },
  { stdout: "[ERROR] Plugin resolution failed\n", stderr: "Native launcher diagnostic\n" },
  { stdout: "", stderr: "" },
])("Maven failed commands retain both diagnostic streams: %j", async ({ stdout, stderr }) => {
  const directory = await mkdtemp(join(tmpdir(), "maven-diagnostics-"));
  try {
    await writeFile(join(directory, "pom.xml"), "<project />");
    const executable = join(directory, "fake-maven");
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(23);\n`,
      { mode: 0o755 },
    );
    const result = await extractor.extract(
      directory,
      { mavenPath: executable },
      { codebaseId: "test:maven-failure" },
    );
    validateResultV2(result);
    expect(result.graphs).toHaveLength(1);
    expect(result.graphs[0]).toMatchObject({
      interpretation: "unknown",
      rootCompleteness: "unknown",
      roots: [],
      nodes: [],
      edges: [],
      source: { extractor: "maven", files: ["pom.xml"], key: "extraction-failed" },
    });
    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "core.file_extraction_failed",
        severity: "ERROR",
        file: "pom.xml",
        message: `Failed to extract file: Maven dependency extraction failed (exit 23)${stderr || stdout ? `: ${[stderr.trim(), stdout.trim()].filter(Boolean).join("\n")}` : ""}`,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
