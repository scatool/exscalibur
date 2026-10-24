import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { scanFiles } from "@scatool/analyzer-core";
import { hasLockfileInDirectory } from "./discovery.ts";
import { extractorV2 } from "./index-v2.ts";

// Run the actual helper with Windows path semantics and a simulated filesystem.
vi.mock("node:path", async (importOriginal) => {
  const path = await importOriginal<typeof import("node:path")>();
  return {
    ...path,
    dirname: (value: string) => path.win32.dirname(value),
    isAbsolute: (value: string) => path.win32.isAbsolute(value),
    join: (...paths: string[]) => path.win32.join(...paths),
    relative: (from: string, to: string) => path.win32.relative(from, to),
    resolve: (...paths: string[]) => path.win32.resolve("C:/analysis", ...paths),
    sep: path.win32.sep,
  };
});
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(),
}));
vi.mock("@scatool/analyzer-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@scatool/analyzer-core")>()),
  scanFiles: vi.fn(),
  readNormalizedTextFile: vi.fn(async () => '{"name":"app"}'),
}));

const locks = new Set<string>();
const checkedPaths: string[] = [];

beforeEach(() => {
  locks.clear();
  checkedPaths.length = 0;
  vi.mocked(scanFiles).mockReset();
  vi.mocked(existsSync).mockImplementation((file) => {
    const path = win32.resolve("C:/analysis", String(file));
    checkedPaths.push(path);
    return locks.has(path);
  });
});

test("UNC lock lookup preserves the remote share root", () => {
  const lock = "\\\\server\\share\\repo\\package-lock.json";
  locks.add(lock);
  expect(hasLockfileInDirectory("//server/share/repo", "//server/share/repo")).toBe(true);
  expect(checkedPaths).toEqual([lock]);
});

test("an unrelated drive-local shadow lock cannot suppress an unlocked UNC project", () => {
  locks.add("C:\\server\\share\\repo\\package-lock.json");
  expect(hasLockfileInDirectory("//server/share/repo", "//server/share/repo")).toBe(false);
  expect(checkedPaths.length).toBeGreaterThan(0);
  expect(checkedPaths.every((path) => path.startsWith("\\\\server\\share\\repo\\"))).toBe(true);
});

test("UNC ancestors are checked through the codebase root, never above it", () => {
  const root = "\\\\server\\share\\repo";
  const rootLock = `${root}\\package-lock.json`;
  locks.add(rootLock);
  expect(hasLockfileInDirectory("//server/share/repo/packages/app", `${root}\\`)).toBe(true);
  expect(checkedPaths.at(-1)).toBe(rootLock);
  expect(checkedPaths.every((path) => path.startsWith(`${root}\\`))).toBe(true);

  locks.clear();
  checkedPaths.length = 0;
  locks.add("\\\\server\\share\\package-lock.json");
  expect(hasLockfileInDirectory("//server/share/repo/packages/app", root)).toBe(false);
  expect(checkedPaths.every((path) => path.startsWith(`${root}\\`))).toBe(true);
});

test.each(["C:/repo", "C:\\repo", "C:/repo/"])(
  "drive-root spelling %s still finds an ancestor lock",
  (codebase) => {
    locks.add("C:\\repo\\package-lock.json");
    expect(hasLockfileInDirectory("C:/repo/packages/app", codebase)).toBe(true);
    expect(checkedPaths.at(-1)).toBe("C:\\repo\\package-lock.json");
  },
);

test.each(["C:/repo-other", "C:/", "D:/repo"])(
  "discovery does not probe %s outside its codebase",
  (dir) => {
    locks.add(win32.join(dir, "package-lock.json"));
    expect(hasLockfileInDirectory(dir, "C:/repo")).toBe(false);
    expect(checkedPaths).toEqual([]);
  },
);

test.each([
  ["C:/", "C:/package.json", "C:\\analysis\\package-lock.json"],
  ["C:\\", "C:/package.json", "C:\\analysis\\package-lock.json"],
  ["//server/share/", "//server/share/package.json", "C:\\server\\share\\package-lock.json"],
])("manifest discovery at %s uses the absolute filesystem parent", async (root, file, shadow) => {
  locks.add(shadow);
  vi.mocked(scanFiles).mockResolvedValue([file]);
  const result = await extractorV2.extract(root, undefined, { codebaseId: "example:windows" });
  expect(result.issues).toEqual([]);
  expect(result.subprojects).toHaveLength(1);
  expect(result.graphs).toHaveLength(1);
  expect(checkedPaths).not.toContain(shadow);
  const expectedDirectory = win32.resolve(root);
  expect(checkedPaths.length).toBeGreaterThan(0);
  expect(checkedPaths.every((path) => win32.dirname(path) === expectedDirectory)).toBe(true);

  locks.add(win32.join(root, "package-lock.json"));
  const locked = await extractorV2.extract(root, undefined, { codebaseId: "example:windows" });
  expect(locked.issues).toEqual([]);
  expect(locked.graphs).toEqual([]);
});
