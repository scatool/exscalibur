import { filesExtractor, readTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { extractCycloneDX } from "./converter.ts";

export const extractor = filesExtractor({
  name: "cyclonedx",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/*.cdx.json", []);
  },
  extractFile: async (file, _options, context) =>
    extractCycloneDX(await readTextFile(file), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
    }),
});
