import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname, join } from 'node:path';
import { findLineNumber, parsePackagePattern, parseYarnLockfile, resolvePackageVersion } from './lockfile.ts';
import type { PackageJson } from '../types.ts';
import { createNpmPurl, extractNpmScopes, readPackageJson } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'yarnlock',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const lockfileGlob = new Glob('**/yarn.lock');
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        // Only mark Yarn Classic (v1) lockfiles
        // Yarn Berry lockfiles have "__metadata:" section with version 8+
        try {
          const fileHandle = Bun.file(file);
          const stream = fileHandle.stream();
          const reader = stream.getReader();

          // Read first ~500 bytes to check for Yarn Berry marker
          const { value } = await reader.read();
          let buffer = '';
          if (value) {
            buffer = new TextDecoder().decode(value.slice(0, 500));
          }
          reader.releaseLock();

          // Skip Yarn Berry lockfiles (they have __metadata: section)
          if (!buffer.includes('__metadata:')) {
            this.markFile(file);
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const lockfileContent = await Bun.file(file).text();
    const lockfile = parseYarnLockfile(lockfileContent);

    // Read root package.json to determine workspace setup
    const packageJsonPath = join(dir, 'package.json');
    const rootPackageInfo = await readPackageJson(packageJsonPath);

    // Collect workspace package.json files if this is a workspace root
    const workspacePackageJsonPaths: string[] = [];
    const isWorkspaceRoot = rootPackageInfo?.workspaces && Array.isArray(rootPackageInfo.workspaces);

    if (isWorkspaceRoot && rootPackageInfo) {
      const workspacePatterns = rootPackageInfo.workspaces as string[];
      for (const pattern of workspacePatterns) {
        const pkgJsonPattern = `${pattern}/package.json`;
        const pkgJsonGlob = new Glob(pkgJsonPattern);
        for await (const pkgPath of pkgJsonGlob.scan({ cwd: dir, absolute: true })) {
          if (!pkgPath.includes('/node_modules/')) {
            workspacePackageJsonPaths.push(pkgPath);
          }
        }
      }
    }

    // Build a map of workspace package names to their versions
    // We need to do this before extracting scopes so we can identify workspace dependencies
    const workspacePackages = new Map<string, string>();
    if (rootPackageInfo?.name && rootPackageInfo?.version) {
      workspacePackages.set(rootPackageInfo.name, rootPackageInfo.version);
    }
    // Add all workspace packages from their package.json files
    if (isWorkspaceRoot && workspacePackageJsonPaths.length > 0) {
      for (const pkgJsonPath of workspacePackageJsonPaths) {
        const pkgInfo = await readPackageJson(pkgJsonPath);
        if (pkgInfo?.name && pkgInfo.version) {
          workspacePackages.set(pkgInfo.name, pkgInfo.version);
        }
      }
    }

    const extractScopesFromPackageJson = (packageInfo: PackageJson): DependencyScope[] => {
      return extractNpmScopes(packageInfo as Record<string, unknown>, (depName, versionRange) => {
        if (versionRange.startsWith('workspace:') || versionRange.startsWith('link:')) {
          return null;
        }
        const workspaceVersion = workspacePackages.get(depName);
        if (workspaceVersion) {
          return createNpmPurl(depName, workspaceVersion);
        }
        const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
        return resolvedVersion ? createNpmPurl(depName, resolvedVersion) : null;
      });
    };

    // Create subproject for root package if it has name and version
    if (rootPackageInfo?.name && rootPackageInfo?.version) {
      const rootPurl = createNpmPurl(rootPackageInfo.name, rootPackageInfo.version);
      const rootScopes = extractScopesFromPackageJson(rootPackageInfo);

      subprojects.push({
        purl: rootPurl,
        definitionFile: packageJsonPath,
        scopes: rootScopes,
      });
    }

    // Create subprojects for workspace packages
    if (isWorkspaceRoot && workspacePackageJsonPaths.length > 0) {
      for (const pkgJsonPath of workspacePackageJsonPaths) {
        const pkgInfo = await readPackageJson(pkgJsonPath);
        if (pkgInfo?.name && pkgInfo.version) {
          const purl = createNpmPurl(pkgInfo.name, pkgInfo.version);
          const scopes = extractScopesFromPackageJson(pkgInfo);

          subprojects.push({
            purl,
            definitionFile: pkgJsonPath,
            scopes,
          });
        }
      }
    }

    // Process all packages in the lockfile
    const processedPackages = new Set<string>(); // Track unique package@version to avoid duplicates

    for (const [pattern, packageEntry] of lockfile.packages.entries()) {
      const parsed = parsePackagePattern(pattern);
      if (!parsed) continue;

      const { name } = parsed;
      const version = packageEntry.version;

      if (!version) continue;

      // Create a unique key for this package
      const packageKey = `${name}@${version}`;
      if (processedPackages.has(packageKey)) {
        continue; // Already processed this exact package
      }
      processedPackages.add(packageKey);

      const purl = createNpmPurl(name, version);

      // Add package with evidence
      ensurePackageExists(packageMap, purl);

      const lineNumber = findLineNumber(lockfileContent, lockfile, name, version);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Extract relationships from dependencies
      processDependencies(packageEntry, purl, lockfile, packageMap, relationshipsMap);
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

/**
 * Process dependencies from a package entry and add relationships
 */
function processDependencies(
  packageEntry: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> },
  purl: string,
  lockfile: ReturnType<typeof parseYarnLockfile>,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  const depsToProcess = [
    ...(packageEntry.dependencies ? Object.entries(packageEntry.dependencies) : []),
    ...(packageEntry.optionalDependencies ? Object.entries(packageEntry.optionalDependencies) : []),
  ];

  for (const [depName, depVersionRange] of depsToProcess) {
    // Resolve the actual version from the lockfile
    const resolvedVersion = resolvePackageVersion(lockfile, depName, depVersionRange);
    if (!resolvedVersion) continue;

    const depPurl = createNpmPurl(depName, resolvedVersion);

    addRelationship(relationshipsMap, purl, depPurl);
    ensurePackageExists(packageMap, depPurl);
  }
}
