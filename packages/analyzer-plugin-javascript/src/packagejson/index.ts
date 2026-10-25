import { dirname as filesystemDirname } from "node:path";
import { dirname } from "node:path/posix";
import {
  filesExtractor,
  mergeIgnorePatterns,
  readNormalizedTextFile,
  scanFiles,
} from "@scatool/analyzer-core";
import { NpmGraph, type NpmRecord } from "../npm-graph.ts";
import { addManifestObservation } from "../npm-manifest.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { hasLockfileInDirectory } from "./discovery.ts";

/** Manifest declarations have no invented resolved components or versions. */
export const extractor = filesExtractor<JavaScriptOptions>({
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
    const builder = new NpmGraph(context, "packagejson", "declared");
    addManifestObservation(
      builder,
      dirname(context.relativeFile),
      context.relativeFile,
      manifest as NpmRecord,
    );
    return builder.finish();
  },
});

export { hasLockfileInDirectory } from "./discovery.ts";
