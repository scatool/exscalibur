import {
  type AnalyzerResult,
  type Extractor,
  filesExtractor,
  runCommand,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { extractCycloneDX } from "@scatool/analyzer-plugin-cdx";
import { dirname } from "node:path/posix";
import type { UvOptions } from "./options.ts";
import { optionSchema } from "./options.ts";

export const extractor: Extractor<UvOptions> = filesExtractor<UvOptions>({
  name: "uv",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: UvOptions) {
    await scanAndMarkFiles(this, codebase, "**/uv.lock", options.ignore);
  },
  extractFile: async (file: string, options: UvOptions): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const uvPath = options.uvPath;

    const { stdout, stderr, exitCode } = await runCommand(
      [uvPath, "export", "--format", "cyclonedx1.5", "--frozen", "--no-emit-project"],
      { cwd: dir },
    );

    if (exitCode !== 0) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            code: "uv.export_failed",
            severity: "ERROR",
            message: `uv export failed with exit code ${exitCode}: ${stderr}`,
            file,
          },
        ],
      };
    }

    return extractCycloneDX(stdout);
  },
});
