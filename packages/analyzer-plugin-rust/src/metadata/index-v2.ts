import { filesExtractorV2, readNormalizedTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { z } from "zod";
import { convertCargoMetadataV2 } from "./converter-v2.ts";

const optionsSchema = z.strictObject({
  ignore: z.array(z.string()).default(["**/target/**"]),
  definitionFilePrefix: z.string().optional(),
  context: z.record(z.string(), z.json()).optional(),
  toolVersion: z.string().optional(),
});
export const extractorV2 = filesExtractorV2({
  name: "cargometadata",
  version: 1,
  optionsSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/cargo-metadata.json", options.ignore);
  },
  extractFile: async (file, options, context) =>
    convertCargoMetadataV2(JSON.parse(await readNormalizedTextFile(file)), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
      definitionFilePrefix: options.definitionFilePrefix,
      context: options.context,
      toolVersion: options.toolVersion,
    }),
});
