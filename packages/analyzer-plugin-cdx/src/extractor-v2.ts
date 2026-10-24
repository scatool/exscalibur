import { filesExtractorV2, readTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { extractCycloneDXV2 } from "./converter-v2.ts";

export const extractorV2 = filesExtractorV2({
  name: "cyclonedx",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/*.cdx.json", []);
  },
  extractFile: async (file, _options, context) =>
    extractCycloneDXV2(await readTextFile(file), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
    }),
});
