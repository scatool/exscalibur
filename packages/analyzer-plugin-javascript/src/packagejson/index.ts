import { type Extractor, filesExtractor, type AnalyzerResult } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { JavaScriptOptions } from '../options.ts';

async function hasLockfileInDirectory(dir: string, codebase: string): Promise<boolean> {
  const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];

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
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/package.json');
    for await (const file of glob.scan({ cwd: codebase, absolute: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (shouldIgnore) {
        continue;
      }

      // Skip if a lockfile exists in the same directory or any parent directory
      const dir = dirname(file);
      if (await hasLockfileInDirectory(dir, codebase)) {
        continue;
      }

      this.markFile(file);
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    // Process individual package.json file
    const content = await Bun.file(file).text();

    let packageJson: any;
    try {
      packageJson = JSON.parse(content);
    } catch (error) {
      // Return empty result with an error issue if JSON is malformed
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            message: `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'ERROR',
            file,
          },
        ],
      };
    }

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

            // Create a proper Package URL (PURL)
            let namespace: string | null = null;
            let packageName = name;
            if (name.startsWith('@')) {
              const parts = name.split('/');
              if (parts.length === 2 && parts[0] && parts[1]) {
                namespace = parts[0]; // Keep @ for proper PURL encoding
                packageName = parts[1];
              }
            }

            const purl = new PackageURL('npm', namespace, packageName, cleanVersion, null, null);

            // Find line number for evidence
            const lineNumber = findLineNumber(lines, name);
            const evidence = lineNumber ? [`${file}:${lineNumber}`] : [];

            packages.push({
              purl: purl.toString(),
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
