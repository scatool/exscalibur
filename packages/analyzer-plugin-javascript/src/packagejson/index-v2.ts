import { dirname as filesystemDirname } from "node:path";
import { dirname } from "node:path/posix";
import {
  filesExtractorV2,
  mergeIgnorePatterns,
  readNormalizedTextFile,
  scanFiles,
} from "@scatool/analyzer-core";
import { NpmGraphV2, addManifestObservation, type NpmRecord } from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { hasLockfileInDirectory } from "./discovery.ts";

/** Manifest declarations have no invented resolved components or versions. */
export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "packagejson",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    for (const file of await scanFiles(
      codebase,
      "**/package.json",
      mergeIgnorePatterns(this, options.ignore),
    )) {
      if (!hasLockfileInDirectory(filesystemDirname(file), codebase)) this.markFile(file);
    }
  },
  extractFile: async (file, _options, context) => {
    const manifest: unknown = JSON.parse(await readNormalizedTextFile(file));
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest))
      throw new Error("Expected a package manifest object");
    const builder = new NpmGraphV2(context, "packagejson", "declared");
    addManifestObservation(
      builder,
      dirname(context.relativeFile),
      context.relativeFile,
      manifest as NpmRecord,
    );
    return builder.finish();
  },
});
