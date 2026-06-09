import { type Extractor, filesExtractor } from "@scatool/analyzer-core";
import { optionsSchema, type VcpkgOptions } from "./options.ts";

// split into separate file to modularize: allow tests to reuse same functions without sharing them
// with the public plugin interface
import { extractFile, markFiles } from "./vcpkg.ts";

export const extractor: Extractor<VcpkgOptions> = filesExtractor<VcpkgOptions>({
  name: "vcpkg",
  version: 1,
  optionsSchema: optionsSchema,
  markFiles: markFiles,
  extractFile: extractFile,
});
