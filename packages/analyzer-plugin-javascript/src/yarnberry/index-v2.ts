import {
  filesExtractorV2,
  mergeIgnorePatterns,
  readNormalizedTextFile,
  scanFiles,
} from "@scatool/analyzer-core";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { extractYarnV2 } from "../yarn-v2.ts";

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "yarnberry",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    for (const file of await scanFiles(
      codebase,
      "**/yarn.lock",
      mergeIgnorePatterns(this, options.ignore),
    )) {
      if (/^__metadata:\s*$/m.test(await readNormalizedTextFile(file))) this.markFile(file);
    }
  },
  extractFile: (file, options, context) => extractYarnV2(file, options, context, true),
});
