import { filesExtractorV2, readTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { optionSchema, type SpdxOptions } from "./options.ts";
import { extractSpdxV2 } from "./converter-v2.ts";

export const extractorV2 = filesExtractorV2<SpdxOptions>({
  name: "spdx",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/*.spdx.{json,jsonld,yaml,yml}", options.ignore);
  },
  extractFile: async (file, _options, context) =>
    extractSpdxV2(await readTextFile(file), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
    }),
});
