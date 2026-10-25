import {
  filesExtractor,
  mergeIgnorePatterns,
  readNormalizedTextFile,
  scanFiles,
} from "@scatool/analyzer-core";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { extractYarn } from "../yarn.ts";

export const extractor = filesExtractor<JavaScriptOptions>({
  name: "yarnlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    for (const file of await scanFiles(
      codebase,
      "**/yarn.lock",
      mergeIgnorePatterns(this, options.ignore),
    )) {
      if (!/^__metadata:\s*$/m.test(await readNormalizedTextFile(file))) this.markFile(file);
    }
  },
  extractFile: (file, options, context) => extractYarn(file, options, context, false),
});
