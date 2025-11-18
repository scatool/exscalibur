import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname, join } from 'node:path';
import { createPypiPurl, normalizePythonName } from '../python-utils.ts';
import type { PythonOptions } from '../options.ts';

interface PipfileLock {
  _meta?: {
    sources?: Array<{ name: string; url: string }>;
    requires?: { python_version?: string };
  };
  default?: Record<string, PackageEntry>;
  develop?: Record<string, PackageEntry>;
}

interface PackageEntry {
  version: string;
  hashes?: string[];
  markers?: string;
  index?: string;
  extras?: string[];
}

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: 'pipfilelock',
  version: 1,
  options: async () => ({
    ignore: ['**/.venv/**', '**/venv/**', '**/__pycache__/**'],
  }),
  markFiles: async function (codebase: string, options: PythonOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/Pipfile.lock');
    for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const dir = dirname(file);
    const lines = content.split('\n');

    const lockfile: PipfileLock = JSON.parse(content);
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    // Try to read Pipfile to get project name and version
    const pipfilePath = join(dir, 'Pipfile');
    let projectName: string | null = null;
    let projectVersion = '0.0.0';

    try {
      const pipfileContent = await Bun.file(pipfilePath).text();
      // Try to extract project name from Pipfile (if it exists)
      // Pipfile doesn't have a standard way to specify project name,
      // so we'll use the directory name as fallback
      const nameMatch = pipfileContent.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch) {
        projectName = nameMatch[1];
      }
    } catch {
      // Pipfile doesn't exist or is unreadable
    }

    // If no project name found, use directory name
    if (!projectName) {
      projectName = dirname(file).split('/').pop() || 'unknown';
    }

    // Build a map of all packages with their resolved versions
    const packageVersionMap = new Map<string, string>();

    // Process default dependencies
    if (lockfile.default) {
      for (const [name, entry] of Object.entries(lockfile.default)) {
        const normalizedName = normalizePythonName(name);
        // Remove leading == from version
        const version = entry.version.startsWith('==') ? entry.version.substring(2) : entry.version;
        packageVersionMap.set(normalizedName, version);

        const purl = createPypiPurl(name, version);
        ensurePackageExists(packageMap, purl);

        // Find line number for this package
        const lineNumber = findPackageLineNumber(lines, name);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }
      }
    }

    // Process develop dependencies
    if (lockfile.develop) {
      for (const [name, entry] of Object.entries(lockfile.develop)) {
        const normalizedName = normalizePythonName(name);
        const version = entry.version.startsWith('==') ? entry.version.substring(2) : entry.version;
        packageVersionMap.set(normalizedName, version);

        const purl = createPypiPurl(name, version);
        ensurePackageExists(packageMap, purl);

        const lineNumber = findPackageLineNumber(lines, name);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }
      }
    }

    // Create subproject with dependency scopes
    const scopes: DependencyScope[] = [];

    if (lockfile.default && Object.keys(lockfile.default).length > 0) {
      const packages = Object.keys(lockfile.default).map((name) => {
        const version = packageVersionMap.get(normalizePythonName(name))!;
        return createPypiPurl(name, version);
      });
      scopes.push({
        scope: 'dependencies',
        packages,
      });
    }

    if (lockfile.develop && Object.keys(lockfile.develop).length > 0) {
      const packages = Object.keys(lockfile.develop).map((name) => {
        const version = packageVersionMap.get(normalizePythonName(name))!;
        return createPypiPurl(name, version);
      });
      scopes.push({
        scope: 'dev-dependencies',
        packages,
      });
    }

    if (scopes.length > 0) {
      const projectPurl = createPypiPurl(projectName, projectVersion);
      subprojects.push({
        purl: projectPurl,
        definitionFile: pipfilePath,
        scopes,
      });
    }

    const packages = convertPackageMapToArray(packageMap);
    const relationships = convertRelationshipsMapToArray(relationshipsMap);

    return {
      packages,
      subprojects,
      relationships,
      issues: [],
    };
  },
});

/**
 * Find the line number where a package appears in the Pipfile.lock
 */
function findPackageLineNumber(lines: string[], packageName: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim().startsWith(`"${packageName}":`)) {
      return i + 1;
    }
  }
  return undefined;
}
