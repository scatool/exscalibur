import {
  filesExtractorV2,
  readTextFile,
  scanAndMarkFiles,
  type JsonObject,
  type JsonValue,
} from "@scatool/analyzer-core";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { convertOrtResultV2 } from "./converter-v2.ts";
import type { OrtAnalyzerResult, OrtResultFile } from "./model.ts";

const optionsSchema = z.strictObject({ definitionFilePrefix: z.string().optional() });
export type OrtV2Options = z.infer<typeof optionsSchema>;

export const extractorV2 = filesExtractorV2<OrtV2Options>({
  name: "ort",
  version: 1,
  optionsSchema,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/analyzer-result.{json,yml,yaml}", []);
  },
  extractFile: async (file, options, context) => {
    const parsed: unknown = parseYaml(await readTextFile(file));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an ORT analyzer result object");
    }
    const wrapped = parsed as OrtResultFile;
    const contextFacts: JsonObject = {};
    const excludes = wrapped.repository?.config?.excludes;
    const environment = wrapped.analyzer?.environment;
    if (excludes !== undefined)
      contextFacts["ort:excludes"] = JSON.parse(JSON.stringify(excludes)) as JsonValue;
    if (environment?.os !== undefined) contextFacts["ort:analyzerOS"] = environment.os;
    if (environment?.tool_versions !== undefined)
      contextFacts["ort:toolVersions"] = environment.tool_versions;
    return convertOrtResultV2(wrapped.analyzer?.result ?? (parsed as OrtAnalyzerResult), {
      codebase: context.codebaseId,
      evidenceFile: context.relativeFile,
      definitionFilePrefix: options.definitionFilePrefix,
      toolVersion: wrapped.analyzer?.environment?.ort_version,
      ...(Object.keys(contextFacts).length > 0 && { context: contextFacts }),
    });
  },
});
