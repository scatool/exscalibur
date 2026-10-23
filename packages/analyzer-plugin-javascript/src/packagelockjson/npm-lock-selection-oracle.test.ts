import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

type RecordValue = Record<string, unknown>;
type Lock = { packages: Record<string, RecordValue> };
const fixturesDirectory = join(import.meta.dirname, "__fixtures__", "npm-lock-selection-oracle");
const inputBytes = await readFile(join(fixturesDirectory, "inputs.json"));
const fixtures = JSON.parse(inputBytes.toString("utf8")) as Array<{
  id: string;
  files: Record<string, RecordValue | string>;
}>;
const capture = JSON.parse(
  await readFile(join(fixturesDirectory, "native-output.json"), "utf8"),
) as {
  versions: Record<string, string>;
  inputSha256: string;
  observations: Array<{
    id: string;
    selectedLock?: string;
    root?: { name: string; version: string | null };
    edges?: Array<{ spec: string; version: string; error: string | null }>;
    error?: string;
  }>;
};

test("native selection capture preserves precedence, current-root overlay, and basename fallback", () => {
  expect(capture.versions).toEqual({ node: "22.23.4", npm: "11.9.0", arborist: "9.2.0" });
  expect(capture.inputSha256).toBe(createHash("sha256").update(inputBytes).digest("hex"));
  expect(capture.observations.map((item) => item.id)).toEqual(fixtures.map((item) => item.id));
  expect(fixtures).toHaveLength(7);
  const observation = (id: string) => capture.observations.find((item) => item.id === id)!;
  expect(observation("both").selectedLock).toBe("npm-shrinkwrap.json");
  expect(observation("stale").edges).toEqual([
    { name: "foo", spec: "2.0.0", to: "node_modules/foo", version: "1.0.0", error: "INVALID" },
  ]);
  expect(observation("missing-manifest").root).toEqual({ name: "app", version: "1.0.0" });
  expect(observation("malformed-manifest").root).toEqual(observation("missing-manifest").root);
  expect(observation("missing-root-name").root).toEqual({ name: "project", version: null });
  expect(observation("missing-root-record").root).toEqual({ name: "project", version: null });
  expect(observation("invalid-shrinkwrap")).toEqual({ id: "invalid-shrinkwrap", error: "ENOLOCK" });
});

test.each(fixtures)(
  "$id preserves raw observations independently of native lock selection",
  async (fixture) => {
    const directory = await mkdtemp(join(tmpdir(), "excalibur-lock-selection-"));
    try {
      for (const [file, value] of Object.entries(fixture.files)) {
        await writeFile(
          join(directory, file),
          typeof value === "string" ? value : JSON.stringify(value),
        );
      }
      const result = await extractorV2.extract(directory, undefined, {
        codebaseId: "test:npm-lock-selection",
      });
      validateResultV2(result);
      const locks = Object.entries(fixture.files).filter(([file]) => file !== "package.json");
      expect(
        result.graphs.filter((graph) => graph.source.extractor === "packagelockjson"),
      ).toHaveLength(locks.length);
      for (const [file, value] of locks) {
        const graph = result.graphs.find(
          (item) => item.source.extractor === "packagelockjson" && item.source.files.includes(file),
        )!;
        if (typeof value === "string") {
          expect(graph.interpretation).toBe("unknown");
          expect(graph.rootCompleteness).toBe("unknown");
          expect(result.issues).toContainEqual(
            expect.objectContaining({ code: "core.file_extraction_failed", file }),
          );
          continue;
        }
        expect(graph.interpretation).toBe("locked");
        expect(graph.roots).toHaveLength(4);
        const lock = value as Lock;
        const root = graph.roots.find((item) => item.scope === "dependencies")!;
        const requests = graph.edges.filter((edge) => edge.from === root.node);
        const expected = Object.entries(
          (lock.packages[""]?.dependencies ?? {}) as Record<string, string>,
        );
        expect(requests.map((edge) => [edge.requested?.name, edge.requested?.specifier])).toEqual(
          expected,
        );
        for (const edge of requests) {
          const name = edge.requested!.name!;
          const version = lock.packages[`node_modules/${name}`]!.version;
          if (typeof version !== "string") throw new Error("Expected a native package version");
          expect(graph.nodes.find((node) => node.id === edge.to)?.purl).toBe(
            `pkg:npm/${name}@${version}`,
          );
        }
        // Explicit top-level identity is retained even where Arborist supplies a directory basename.
        expect(root.project.purl).toBe("pkg:npm/app@1.0.0");
      }
      if (fixture.id === "stale" || fixture.id === "both") {
        const current = result.graphs.find((graph) => graph.interpretation === "declared")!;
        expect(current).toBeDefined();
        const root = current.roots.find((item) => item.scope === "dependencies")!;
        expect(current.edges.filter((edge) => edge.from === root.node)).toEqual([
          expect.objectContaining({
            status: "declared",
            requested: expect.objectContaining({ name: "foo", specifier: "2.0.0" }),
          }),
        ]);
        expect(result.issues).toContainEqual(
          expect.objectContaining({ code: "npm.manifest_lock_mismatch" }),
        );
      }
      if (fixture.id === "malformed-manifest") {
        expect(result.issues).toContainEqual(
          expect.objectContaining({ code: "npm.manifest_unreadable", file: "package.json" }),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
