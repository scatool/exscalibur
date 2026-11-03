import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { normalizeResult, runCommand, validateResult } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";
import type { ConanFileGraph } from "./types.ts";
import provenance from "./__recorded__/provenance.json";

vi.mock("@scatool/analyzer-core", async (original) => ({
  ...(await original<typeof import("@scatool/analyzer-core")>()),
  runCommand: vi.fn(),
}));

const recordedDirectory = join(import.meta.dirname, "__recorded__");
const fixturesDirectory = join(import.meta.dirname, "__fixtures__");
const repositoryDirectory = join(import.meta.dirname, "../../..");
const digest = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

for (const capture of provenance.captures) {
  test(`recorded Conan graph: ${capture.fixture}`, async () => {
    const content = await readFile(join(recordedDirectory, capture.recording), "utf8");
    expect(digest(content)).toBe(capture.recordingSha256);
    const recording = JSON.parse(content) as {
      command: string[];
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    expect(digest(recording.stdout)).toBe(capture.stdoutSha256);
    expect(digest(recording.stderr)).toBe(capture.stderrSha256);
    for (const [file, expectedHash] of Object.entries(capture.inputs)) {
      expect(digest(await readFile(join(repositoryDirectory, file))), file).toBe(expectedHash);
    }

    // Replay the exact native output, including binary state and warnings. The
    // profile token describes the hash-verified fixture without a checkout path.
    const profile = "__fixtures__/profile";
    vi.mocked(runCommand).mockReset().mockResolvedValueOnce(recording);
    const directory = join(fixturesDirectory, capture.fixture);
    const result = await extractor.extract(
      directory,
      { profileBuild: profile, profileHost: profile },
      { codebaseId: `fixture:${capture.fixture}` },
    );
    expect(runCommand).toHaveBeenCalledExactlyOnceWith([
      "conan",
      "graph",
      "info",
      join(directory, capture.definitionFile),
      "--format",
      "json",
      "--profile:build",
      profile,
      "--profile:host",
      profile,
    ]);

    validateResult(result);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    expect(result.graphs).toHaveLength(1);
    const graph = result.graphs[0]!;
    const input = JSON.parse(recording.stdout) as ConanFileGraph;
    for (const [id, native] of Object.entries(input.graph.nodes)) {
      const direct = Object.entries(native.dependencies ?? {})
        .filter(([, dependency]) => dependency.direct !== false)
        .map(([target]) => target)
        .sort();
      expect(
        graph.edges
          .filter((edge) => edge.from === id)
          .map((edge) => (edge.status === "resolved" ? edge.to : "unresolved"))
          .sort(),
      ).toEqual(direct);
    }
    expect(result.issues).toEqual(
      recording.stderr.includes("WARN")
        ? [
            {
              code: "conanfile.command_warning",
              file: capture.definitionFile,
              message: recording.stderr,
              severity: "WARNING",
            },
          ]
        : [],
    );

    expect(normalizeResult(result)).toMatchSnapshot();
  });
}
