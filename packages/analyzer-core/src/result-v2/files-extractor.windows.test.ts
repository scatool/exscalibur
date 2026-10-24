import { win32 } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { filesExtractorV2 } from "./files-extractor.ts";
import { createEmptyResultV2 } from "./merge.ts";

// Exercise Windows path semantics deterministically; this does not use a native Windows filesystem.
vi.mock("node:path", async (importOriginal) => {
  const path = await importOriginal<typeof import("node:path")>();
  return {
    ...path,
    isAbsolute: (value: string) => path.win32.isAbsolute(value),
    relative: (from: string, to: string) => path.win32.relative(from, to),
    resolve: (...paths: string[]) => path.win32.resolve(...paths),
    sep: path.win32.sep,
  };
});

test.each([
  ["C:/repo", "C:/repo"],
  ["C:\\repo", "C:/repo"],
  ["\\\\server\\share\\repo", "//server/share/repo"],
])("Windows discovery receives a slash-normalized root for %s", async (input, discoveryRoot) => {
  let observedRoot: string | undefined;
  const extractor = filesExtractorV2({
    name: "windows-discovery",
    version: 1,
    markFiles: async function (codebase) {
      observedRoot = codebase;
      this.markFile("package.json");
    },
    extractFile: async (file, _options, context) => {
      expect(file).toBe(win32.join(win32.resolve(input), "package.json"));
      expect(context.codebasePath).toBe(win32.resolve(input));
      expect(context.relativeFile).toBe("package.json");
      return createEmptyResultV2(context.codebaseId);
    },
  });
  const result = await extractor.extract(input, undefined, { codebaseId: "example:windows" });
  expect(result.issues).toEqual([]);
  expect(observedRoot).toBe(discoveryRoot);
});
