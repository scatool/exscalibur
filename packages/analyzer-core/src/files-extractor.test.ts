import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { filesExtractor, scanAndMarkFiles } from "./index.ts";

test("scanAndMarkFiles works with legacy mark file contexts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "excalibur-legacy-context-"));

  try {
    await writeFile(join(dir, "package.json"), "");

    const markedFiles: string[] = [];
    await scanAndMarkFiles(
      {
        markFile: (file) => markedFiles.push(file),
      },
      dir,
      "**/package.json",
      [],
    );

    expect(markedFiles).toEqual([join(dir, "package.json")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("filesExtractor applies global ignore patterns during file discovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "excalibur-global-ignore-"));

  try {
    await mkdir(join(dir, "ignored"), { recursive: true });
    await writeFile(join(dir, "kept.txt"), "");
    await writeFile(join(dir, "ignored", "skipped.txt"), "");

    const extractor = filesExtractor({
      name: "test",
      version: 1,
      markFiles: async function (codebase: string) {
        await scanAndMarkFiles(this, codebase, "**/*.txt", []);
      },
      extractFile: async (file: string) => ({
        packages: [{ purl: `pkg:generic/${basename(file)}`, evidence: [file] }],
        subprojects: [],
        relationships: [],
        issues: [],
      }),
    });

    const result = await extractor.extract(dir, undefined, { ignore: ["ignored/**"] });

    expect(result.packages).toEqual([{ purl: "pkg:generic/kept.txt", evidence: ["kept.txt"] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
