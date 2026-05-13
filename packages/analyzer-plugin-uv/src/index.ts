import {
  type AnalyzerResult,
  type Extractor,
  filesExtractor,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { extractCycloneDX } from '@scatool/analyzer-plugin-cdx/src/index.ts';
import { dirname } from 'node:path/posix';
import type { UvOptions } from './options.ts';
import { optionSchema } from './options.ts';

export const extractor: Extractor<UvOptions> = filesExtractor<UvOptions>({
  name: 'uv',
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: UvOptions) {
    await scanAndMarkFiles(this, codebase, '**/uv.lock', options.ignore);
  },
  extractFile: async (file: string, options: UvOptions): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const uvPath = options.uvPath;

    const proc = Bun.spawn([uvPath, 'export', '--format', 'cyclonedx1.5', '--frozen', '--no-emit-project'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: 'ERROR',
            message: `uv export failed with exit code ${exitCode}: ${stderr}`,
            file,
          },
        ],
      };
    }

    return extractCycloneDX(stdout);
  },
});
