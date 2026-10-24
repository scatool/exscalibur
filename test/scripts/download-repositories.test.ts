import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireRepository,
  directoryState,
  matchingReceipt,
  parseArguments,
  selectRepositories,
} from "./download-repositories.ts";

const repo = { owner: "example", repository: "source", commit: "a".repeat(40) };
const receipt = { ...repo, tree: "b".repeat(40), transport: "git", archiveSha256: "c".repeat(64) };

test("archive remains default and Git/case selection must be explicit", () => {
  expect(parseArguments([])).toEqual({ transport: "archive", cases: [] });
  expect(parseArguments(["--transport", "git", "--case", "example+source"])).toEqual({
    transport: "git",
    cases: ["example+source"],
  });
  expect(selectRepositories([repo], ["example+source"])).toEqual([repo]);
  expect(() => selectRepositories([repo], ["missing"])).toThrow("Unknown repository case");
  for (const args of [["--transport", "auto"], ["--case"], ["--unknown"]])
    expect(() => parseArguments(args)).toThrow();
  expect(() => selectRepositories([{ ...repo, commit: "main" }], [])).toThrow();
  expect(() => selectRepositories([{ ...repo, owner: "../outside" }], [])).toThrow();
});

test("cache receipts require the configured revision and verified transport-specific metadata", () => {
  expect(matchingReceipt(receipt, repo)).toBe(true);
  expect(matchingReceipt({ ...receipt, commit: "d".repeat(40) }, repo)).toBe(false);
  expect(matchingReceipt({ ...receipt, tree: null }, repo)).toBe(false);
  expect(matchingReceipt({ ...receipt, archiveSha256: "missing" }, repo)).toBe(false);
  expect(matchingReceipt({ ...receipt, transport: "archive", tree: null }, repo)).toBe(true);
});

test("matching cache is skipped and unverified populated source is preserved without network", async () => {
  const dir = await mkdtemp(join(tmpdir(), "download-policy-"));
  const fetch = vi.fn(() => {
    throw new Error("network forbidden in test");
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const source = join(dir, "example+source");
    await mkdir(source);
    await writeFile(join(source, "user-change.txt"), "keep me");
    await expect(acquireRepository(repo, "git", dir)).rejects.toThrow(
      "Preserving existing unverified",
    );
    expect(await readFile(join(source, "user-change.txt"), "utf8")).toBe("keep me");
    await mkdir(join(dir, ".sources"));
    await writeFile(join(dir, ".sources", "example+source.json"), JSON.stringify(receipt));
    expect(await acquireRepository(repo, "archive", dir)).toBe("cached");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed archive transport has no fallback, preserves placeholders and cleans staging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "download-failure-"));
  const fetch = vi.fn(async () => new Response("denied", { status: 403, statusText: "Forbidden" }));
  vi.stubGlobal("fetch", fetch);
  try {
    const source = join(dir, "example+source");
    await mkdir(source);
    await writeFile(join(source, ".gitkeep"), "");
    expect(await directoryState(source)).toBe("placeholder");
    await expect(acquireRepository(repo, "archive", dir)).rejects.toThrow("403 Forbidden");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual(["example+source"]);
    expect(await readdir(source)).toEqual([".gitkeep"]);
    await writeFile(join(source, ".gitkeep"), "user content");
    expect(await directoryState(source)).toBe("populated");
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});

test("successful archive transport publishes source and receipt only after extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "download-success-"));
  try {
    const input = join(dir, "fixture");
    await mkdir(input);
    await writeFile(join(input, "README.md"), "source bytes");
    const archive = join(dir, "fixture.tar.gz");
    await promisify(execFile)("tar", ["-czf", archive, "-C", dir, "fixture"]);
    const bytes = await readFile(archive);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes))),
    );
    const output = join(dir, "repositories");
    const source = join(output, "example+source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, ".gitkeep"), "");
    await writeFile(join(output, "example+source.tar.gz"), "");
    expect(await acquireRepository(repo, "archive", output)).toBe("downloaded");
    expect(await readFile(join(source, "README.md"), "utf8")).toBe("source bytes");
    expect(await readdir(source)).toEqual(["README.md"]);
    const saved = JSON.parse(
      await readFile(join(output, ".sources", "example+source.json"), "utf8"),
    );
    expect(saved).toEqual({
      ...repo,
      tree: null,
      transport: "archive",
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect((await readdir(output)).sort()).toEqual([".sources", "example+source"]);
  } finally {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a nonempty legacy archive marker is preserved even beside a valid source receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "download-marker-"));
  try {
    await mkdir(join(dir, "example+source"));
    await writeFile(join(dir, "example+source", "README.md"), "source");
    await mkdir(join(dir, ".sources"));
    await writeFile(join(dir, ".sources", "example+source.json"), JSON.stringify(receipt));
    await writeFile(join(dir, "example+source.tar.gz"), "user archive");
    await expect(acquireRepository(repo, "git", dir)).rejects.toThrow("Preserving nonempty");
    expect(await readFile(join(dir, "example+source.tar.gz"), "utf8")).toBe("user archive");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
