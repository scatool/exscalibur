import {
  type AnalyzerResult,
  filesExtractor,
  readTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { parse as parseYaml } from "yaml";
import { type OrtAnalyzerResult, type OrtResultFile } from "./model.ts";
import { convertOrtResult } from "./converter.ts";
import type { OrtOptions } from "./options.ts";
import { optionSchema } from "./options.ts";

// Accept both the full ORT result file (`{ analyzer: { result: ... } }`) that
// `ort analyze` writes by default, and the bare AnalyzerResult shape.
function unwrapOrtResult(parsed: unknown): OrtAnalyzerResult {
  if (parsed && typeof parsed === "object") {
    const wrapped = (parsed as OrtResultFile).analyzer?.result;
    if (wrapped) return wrapped;
  }
  return parsed as OrtAnalyzerResult;
}

export const extractor = filesExtractor<OrtOptions>({
  name: "ort",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/analyzer-result.{json,yml,yaml}", []);
  },
  extractFile: async (file, options): Promise<AnalyzerResult> => {
    try {
      const parsed = parseYaml(await readTextFile(file));
      const result = unwrapOrtResult(parsed);

      return convertOrtResult(result, {
        evidenceFile: file,
        useDefinitionFilePaths: options.useDefinitionFilePaths,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: "ERROR",
            message,
            file,
          },
        ],
      };
    }
  },
});
