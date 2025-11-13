import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  aggregateSubprojectRelationships,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname, join } from 'node:path';
import {
  findLineNumber,
  isGitPackageKey,
  parsePackageKey,
  parsePnpmLockfile,
  type PnpmLockfile,
  type PnpmLockfileV6,
  type PnpmLockfileV9,
  stripPeerDepSuffix,
} from './lockfile.ts';
import type { PackageJson } from '../types.ts';
import { createNpmPurl, NPM_DEPENDENCY_SCOPES } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'pnpmlock',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const lockfileGlob = new Glob('**/pnpm-lock.yaml');
    for await (const file of lockfileGlob.scan({ cwd: codebase })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    try {
      const lockfileContent = await Bun.file(file).text();
      const lockfile = parsePnpmLockfile(lockfileContent);

      // Build a map of workspace package names to their versions
      // We need to do this before extracting scopes so we can identify workspace dependencies
      const workspacePackages = new Map<string, string>();
      if (lockfile.importers) {
        for (const [importerPath, importer] of Object.entries(lockfile.importers)) {
          const importerDir = importerPath === '.' ? dir : join(dir, importerPath);
          const packageJsonPath = join(importerDir, 'package.json');

          try {
            const packageJsonContent = await Bun.file(packageJsonPath).text();
            const packageInfo = JSON.parse(packageJsonContent) as PackageJson;
            if (packageInfo.name && packageInfo.version) {
              workspacePackages.set(packageInfo.name, packageInfo.version);
            }
          } catch {
            // Skip invalid package.json files
            continue;
          }
        }
      }

      // Process importers (workspace packages) to create subprojects
      if (lockfile.importers) {
        for (const [importerPath, importer] of Object.entries(lockfile.importers)) {
          // Determine the package.json path for this importer
          const importerDir = importerPath === '.' ? dir : join(dir, importerPath);
          const packageJsonPath = join(importerDir, 'package.json');

          // Read package.json to get name and version
          let packageInfo: PackageJson | null = null;
          try {
            const packageJsonContent = await Bun.file(packageJsonPath).text();
            packageInfo = JSON.parse(packageJsonContent) as PackageJson;
          } catch {
            // Skip if package.json doesn't exist or is invalid
            continue;
          }

          if (packageInfo && packageInfo.name && packageInfo.version) {
            // Create PURL for this subproject
            const purl = createNpmPurl(packageInfo.name, packageInfo.version);

            // Extract scopes - map each dependency type to resolved versions
            const scopes: DependencyScope[] = [];

            for (const scopeName of NPM_DEPENDENCY_SCOPES) {
              const depsInScope: string[] = [];
              const importerDeps = importer[scopeName];

              if (importerDeps && typeof importerDeps === 'object') {
                for (const [depName, depRef] of Object.entries(importerDeps)) {
                  if (depRef && typeof depRef === 'object' && 'version' in depRef) {
                    let version = depRef.version;

                    // Check if this is a workspace package (starts with "link:")
                    if (typeof version === 'string' && version.startsWith('link:')) {
                      // Check if this is a known workspace package
                      const workspaceVersion = workspacePackages.get(depName);
                      if (workspaceVersion) {
                        // Include workspace package with its actual version
                        const depPurl = createNpmPurl(depName, workspaceVersion);
                        depsInScope.push(depPurl);
                      }
                      // Skip if not a known workspace package
                      continue;
                    }

                    // Regular external dependency
                    if (typeof version === 'string') {
                      // Handle pnpm aliases: "alias-name: real-package@version"
                      let actualName = depName;
                      let actualVersion: string;

                      // Strip peer dependency suffix FIRST before checking for aliases
                      // to avoid matching @ inside the suffix like (react@18.2.0)
                      const versionWithoutPeerDeps = stripPeerDepSuffix(version);

                      // Check if this is an alias (version contains @ which indicates package@version format)
                      // Aliases look like: "string-width@4.2.3" or "@docusaurus/react-loadable@6.0.0"
                      // Regular versions look like: "19.2.0" or "1.0.0"
                      const lastAtIndex = versionWithoutPeerDeps.lastIndexOf('@');
                      if (lastAtIndex > 0 && !isGitPackageKey(`${depName}@${versionWithoutPeerDeps}`)) {
                        // Check if what comes before @ looks like a package name (not starting with a digit)
                        const beforeAt = versionWithoutPeerDeps.substring(0, lastAtIndex);
                        if (beforeAt && !/^\d/.test(beforeAt)) {
                          // This is an alias - extract the real package name and version
                          actualName = beforeAt;
                          actualVersion = versionWithoutPeerDeps.substring(lastAtIndex + 1);
                        } else {
                          // Not an alias - use the stripped version
                          actualVersion = versionWithoutPeerDeps;
                        }
                      } else {
                        // Not an alias - use the stripped version
                        actualVersion = versionWithoutPeerDeps;
                      }

                      // For git/tarball dependencies, look up the actual version from packages section
                      const packageKey = `${actualName}@${actualVersion}`;
                      if (isGitPackageKey(packageKey)) {
                        // This is a git/tarball package - look up the actual version
                        const resolvedVersion = getPackageVersion(lockfile, packageKey);
                        if (resolvedVersion) {
                          const depPurl = createNpmPurl(actualName, resolvedVersion);
                          depsInScope.push(depPurl);
                        } else {
                          // Fallback to the git URL if we can't find the version
                          // actualVersion is already stripped if it was an alias
                          const depPurl = createNpmPurl(actualName, actualVersion);
                          depsInScope.push(depPurl);
                        }
                      } else {
                        // Regular package with semantic version
                        // actualVersion is already stripped of peer deps (either from alias extraction or original version)
                        const depPurl = createNpmPurl(actualName, actualVersion);
                        depsInScope.push(depPurl);
                      }
                    }
                  }
                }
              }

              if (depsInScope.length > 0) {
                scopes.push({
                  scope: scopeName,
                  packages: depsInScope,
                });
              }
            }

            subprojects.push({
              purl,
              definitionFile: packageJsonPath,
              scopes,
            });
          }
        }
      }

      // Determine lockfile version and process accordingly
      const lockfileVersionNum =
        typeof lockfile.lockfileVersion === 'string' ? parseFloat(lockfile.lockfileVersion) : lockfile.lockfileVersion;

      if (lockfileVersionNum >= 9) {
        // V9+ lockfile: packages have metadata, snapshots have relationships
        processV9Lockfile(lockfile as PnpmLockfileV9, lockfileContent, file, packageMap, relationshipsMap);
      } else {
        // V6 and earlier: packages have both metadata and relationships
        processV6Lockfile(lockfile as PnpmLockfileV6, lockfileContent, file, packageMap, relationshipsMap);
      }

      // Add relationships from subprojects to their dependencies
      aggregateSubprojectRelationships(subprojects, relationshipsMap);
    } catch (error) {
      // Silently skip files that fail to parse
    }

    // Convert maps to arrays
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
 * Process dependencies from a package entry and add relationships
 */
function processDependencies(
  deps: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
  purl: string,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  const depTypes = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
  for (const depType of depTypes) {
    const depsInScope = deps[depType];
    if (depsInScope && typeof depsInScope === 'object') {
      for (const [depName, depVersion] of Object.entries(depsInScope)) {
        if (typeof depVersion === 'string') {
          // Handle pnpm aliases: "alias-name: real-package@version"
          // The depVersion might be "real-package@version" instead of just a version
          let actualName = depName;
          let actualVersion: string;

          // Strip peer dependency suffix FIRST before checking for aliases
          // to avoid matching @ inside the suffix like (react@18.2.0)
          const versionWithoutPeerDeps = stripPeerDepSuffix(depVersion);

          // Check if this is an alias (version contains @ which indicates package@version format)
          // Aliases look like: "string-width@4.2.3" or "@docusaurus/react-loadable@6.0.0"
          // Regular versions look like: "19.2.0" or "1.0.0"
          const lastAtIndex = versionWithoutPeerDeps.lastIndexOf('@');
          if (lastAtIndex > 0) {
            // Check if what comes before @ looks like a package name (not starting with a digit)
            const beforeAt = versionWithoutPeerDeps.substring(0, lastAtIndex);
            if (beforeAt && !/^\d/.test(beforeAt)) {
              // This is an alias - extract the real package name and version
              actualName = beforeAt;
              actualVersion = versionWithoutPeerDeps.substring(lastAtIndex + 1);
            } else {
              // Not an alias - use the stripped version
              actualVersion = versionWithoutPeerDeps;
            }
          } else {
            // Not an alias - use the stripped version
            actualVersion = versionWithoutPeerDeps;
          }

          const depPurl = createNpmPurl(actualName, actualVersion);

          addRelationship(relationshipsMap, purl, depPurl);
          ensurePackageExists(packageMap, depPurl);
        }
      }
    }
  }
}

/**
 * Process lockfile v9+ format
 * - packages section: metadata only
 * - snapshots section: dependency relationships
 */
function processV9Lockfile(
  lockfile: PnpmLockfileV9,
  lockfileContent: string,
  file: string,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  // Process packages section for metadata
  if (lockfile.packages) {
    for (const [packageKey, packageEntry] of Object.entries(lockfile.packages)) {
      const parsed = parsePackageKey(packageKey);
      if (!parsed) continue;

      let { name, version } = parsed;

      // For git packages, use the version field from the package entry instead of the git URL
      if (packageEntry.version && isGitPackageKey(packageKey)) {
        version = packageEntry.version;
      }

      const purl = createNpmPurl(name, version);

      // Add package with evidence
      ensurePackageExists(packageMap, purl);

      const lineNumber = findLineNumber(lockfileContent, packageKey);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }
    }
  }

  // Process snapshots section for relationships
  if (lockfile.snapshots) {
    for (const [snapshotKey, snapshotEntry] of Object.entries(lockfile.snapshots)) {
      const parsed = parsePackageKey(snapshotKey);
      if (!parsed) continue;

      const { name, version } = parsed;
      const purl = createNpmPurl(name, version);

      // Extract relationships from dependencies
      processDependencies(snapshotEntry, purl, packageMap, relationshipsMap);
    }
  }
}

/**
 * Process lockfile v6 and earlier format
 * - packages section contains both metadata and relationships
 */
function processV6Lockfile(
  lockfile: PnpmLockfileV6,
  lockfileContent: string,
  file: string,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  if (!lockfile.packages) return;

  for (const [packageKey, packageEntry] of Object.entries(lockfile.packages)) {
    const parsed = parsePackageKey(packageKey);
    if (!parsed) continue;

    let { name, version } = parsed;

    // For git packages, use the version field from the package entry instead of the git URL
    if (packageEntry.version && isGitPackageKey(packageKey)) {
      version = packageEntry.version;
    }

    const purl = createNpmPurl(name, version);

    // Add package with evidence
    ensurePackageExists(packageMap, purl);

    const lineNumber = findLineNumber(lockfileContent, packageKey);
    if (lineNumber) {
      packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
    }

    // Extract relationships from dependencies
    processDependencies(packageEntry, purl, packageMap, relationshipsMap);
  }
}

/**
 * Get the actual semantic version for a package from the packages section
 * For git/tarball packages, the version field in the package metadata contains the real version
 */
function getPackageVersion(lockfile: PnpmLockfile, packageKey: string): string | null {
  const lockfileVersionNum =
    typeof lockfile.lockfileVersion === 'string' ? parseFloat(lockfile.lockfileVersion) : lockfile.lockfileVersion;

  if (lockfileVersionNum >= 9) {
    // V9+ lockfile: check packages section for metadata
    const v9Lockfile = lockfile as PnpmLockfileV9;
    if (v9Lockfile.packages) {
      const packageMetadata = v9Lockfile.packages[packageKey];
      if (packageMetadata && packageMetadata.version) {
        return packageMetadata.version;
      }
    }
  } else {
    // V6 and earlier: check packages section
    const v6Lockfile = lockfile as PnpmLockfileV6;
    if (v6Lockfile.packages) {
      const packageEntry = v6Lockfile.packages[packageKey];
      if (packageEntry && packageEntry.version) {
        return packageEntry.version;
      }
    }
  }

  return null;
}
