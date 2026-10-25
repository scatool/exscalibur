import { filesExtractor, readTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { optionSchema, type SpdxOptions } from "./options.ts";
import { extractSpdx } from "./converter.ts";

export const extractor = filesExtractor<SpdxOptions>({
  name: "spdx",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/*.spdx.{json,jsonld,yaml,yml}", options.ignore);
  },
  extractFile: async (file, _options, context) =>
    extractSpdx(await readTextFile(file), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
    }),
});
