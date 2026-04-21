import { type Extractor, filesExtractor, type AnalyzerResult } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createNpmPurl } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

function hasLockfileInDirectory(dir: string, codebase: string): boolean {
  const lockfiles = [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
  ];

  // Check current directory and all parent directories up to the codebase root
  let currentDir = dir;
  while (currentDir.startsWith(codebase)) {
    for (const lockfile of lockfiles) {
      if (existsSync(`${currentDir}/${lockfile}`)) {
        return true;
      }
    }

    // Move to parent directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return false;
}

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'packagejson',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/package.json');
    for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (shouldIgnore) {
        continue;
      }

      // Skip if a lockfile exists in the same directory or any parent directory
      const dir = dirname(file);
      if (hasLockfileInDirectory(dir, codebase)) {
        continue;
      }

      this.markFile(file);
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    // Process individual package.json file
    const content = await Bun.file(file).text();

    const packageJson = JSON.parse(content) as Record<string, unknown>;

    const lines = content.split('\n');
    const packages = [];

    // Extract dependencies (no version resolution, just what's declared)
    const depSections = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.peerDependencies,
      packageJson.optionalDependencies,
    ];

    for (const deps of depSections) {
      if (deps && typeof deps === 'object') {
        for (const [name, versionRange] of Object.entries(deps)) {
          if (typeof versionRange === 'string') {
            // Remove workspace: prefix if present
            let cleanVersion = versionRange.replace(/^workspace:/, '');

            // Strip version range prefixes (^, ~, >=, <=, >, <, =)
            cleanVersion = cleanVersion.replace(/^[\^~>=<]+/, '');

            // Handle version ranges like "1.0.0 - 2.0.0" or ">=1.0.0 <2.0.0"
            // Take the first version in the range
            if (cleanVersion.includes(' ')) {
              const firstPart = cleanVersion.split(/\s+/)[0];
              if (firstPart) {
                cleanVersion = firstPart.replace(/^[\^~>=<]+/, '');
              }
            }

            const purl = createNpmPurl(name, cleanVersion);

            // Find line number for evidence
            const lineNumber = findLineNumber(lines, name);
            const evidence = lineNumber ? [`${file}#${lineNumber}`] : [];

            packages.push({
              purl,
              evidence,
            });
          }
        }
      }
    }

    return {
      packages,
      subprojects: [],
      relationships: [],
      issues: [],
    };
  },
});

// Find the line number where a package is declared
function findLineNumber(lines: string[], packageName: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "packageName": or 'packageName':
    if (line && (line.includes(`"${packageName}"`) || line.includes(`'${packageName}'`))) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}
