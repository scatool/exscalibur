import { type AnalyzerResult, type Extractor, filesExtractor } from '@scatool/analyzer-core/src/index.ts';
import { extractCycloneDX } from '@scatool/analyzer-plugin-cdx/src/index.ts';
import { Glob } from 'bun';
import { dirname } from 'node:path';

export interface UvOptions {
  /**
   * Array of glob patterns to ignore when scanning for uv.lock files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/node_modules\/**', '**\/.venv\/**']
   */
  ignore?: string[];

  /**
   * Path to the uv binary.
   * @default 'uv'
   */
  uvPath?: string;
}

export const extractor: Extractor<UvOptions> = filesExtractor<UvOptions>({
  name: 'uv',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**', '**/.venv/**'],
    uvPath: 'uv',
  }),
  markFiles: async function (codebase: string, options: UvOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/uv.lock');
    for await (const file of glob.scan({ cwd: codebase, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string, options: UvOptions): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const uvPath = options.uvPath ?? 'uv';

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
