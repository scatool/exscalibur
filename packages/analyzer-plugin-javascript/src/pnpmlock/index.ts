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
  initializeExtractionMaps,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
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
    await scanAndMarkFiles(this, codebase, '**/pnpm-lock.yaml', options.ignore ?? []);
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
        for (const [importerPath] of Object.entries(lockfile.importers)) {
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
                      const resolved = resolveAlias(depName, version);

                      // For git/tarball dependencies, look up the actual version from packages section
                      const packageKey = `${resolved.name}@${resolved.version}`;
                      if (isGitPackageKey(packageKey)) {
                        const resolvedVersion = getPackageVersion(lockfile, packageKey);
                        const depPurl = createNpmPurl(resolved.name, resolvedVersion ?? resolved.version);
                        depsInScope.push(depPurl);
                      } else {
                        const depPurl = createNpmPurl(resolved.name, resolved.version);
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
    } catch (error) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            message: `Failed to parse pnpm-lock.yaml: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'ERROR',
            file,
          },
        ],
      };
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
          const resolved = resolveAlias(depName, depVersion);
          const depPurl = createNpmPurl(resolved.name, resolved.version);

          addRelationship(relationshipsMap, purl, depPurl);
          ensurePackageExists(packageMap, depPurl);
        }
      }
    }
  }
}

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

/** Resolves aliased versions like "string-width@4.2.3" and strips peer dep suffixes. */
function resolveAlias(depName: string, version: string): { name: string; version: string } {
  const versionWithoutPeerDeps = stripPeerDepSuffix(version);
  const lastAtIndex = versionWithoutPeerDeps.lastIndexOf('@');

  if (lastAtIndex > 0) {
    const beforeAt = versionWithoutPeerDeps.substring(0, lastAtIndex);
    if (beforeAt && !/^\d/.test(beforeAt)) {
      return { name: beforeAt, version: versionWithoutPeerDeps.substring(lastAtIndex + 1) };
    }
  }

  return { name: depName, version: versionWithoutPeerDeps };
}

/**
 * For git/tarball packages, the version field in the package metadata contains the real
 * semantic version rather than the git URL or tarball path used as the package key.
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
