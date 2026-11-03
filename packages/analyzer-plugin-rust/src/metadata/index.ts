import { filesExtractor, readNormalizedTextFile, scanAndMarkFiles } from "@scatool/analyzer-core";
import { z } from "zod";
import { convertCargoMetadata } from "./converter.ts";

const optionsSchema = z.strictObject({
  ignore: z.array(z.string()).default(["**/target/**"]),
  definitionFilePrefix: z.string().optional(),
  context: z.record(z.string(), z.json()).optional(),
  toolVersion: z.string().optional(),
});
export const extractor = filesExtractor({
  name: "cargometadata",
  version: 1,
  optionsSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/cargo-metadata.json", options.ignore);
  },
  extractFile: async (file, options, context) =>
    convertCargoMetadata(JSON.parse(await readNormalizedTextFile(file)), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
      definitionFilePrefix: options.definitionFilePrefix,
      context: options.context,
      toolVersion: options.toolVersion,
    }),
});
