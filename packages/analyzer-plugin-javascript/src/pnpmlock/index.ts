import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Relationship,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
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

const lockfileGlob = new Glob('**/pnpm-lock.yaml');

const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

export const extractor: Extractor = filesExtractor({
  name: 'pnpmlock',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
    const relationshipsMap = new Map<string, Set<string>>();
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
            const purl = createPurl(packageInfo.name, packageInfo.version);

            // Extract scopes - map each dependency type to resolved versions
            const scopes: DependencyScope[] = [];
            const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

            for (const scopeName of scopeNames) {
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
                        const depPurl = createPurl(depName, workspaceVersion);
                        depsInScope.push(depPurl);
                      }
                      // Skip if not a known workspace package
                      continue;
                    }

                    // Regular external dependency
                    if (typeof version === 'string') {
                      // For git/tarball dependencies, look up the actual version from packages section
                      const packageKey = `${depName}@${version}`;
                      if (isGitPackageKey(packageKey)) {
                        // This is a git/tarball package - look up the actual version
                        const actualVersion = getPackageVersion(lockfile, packageKey);
                        if (actualVersion) {
                          const depPurl = createPurl(depName, actualVersion);
                          depsInScope.push(depPurl);
                        } else {
                          // Fallback to the git URL if we can't find the version
                          version = stripPeerDepSuffix(version);
                          const depPurl = createPurl(depName, version);
                          depsInScope.push(depPurl);
                        }
                      } else {
                        // Regular package with semantic version
                        // Strip peer dependency suffix: "19.2.0(react@19.2.0)" -> "19.2.0"
                        version = stripPeerDepSuffix(version);
                        const depPurl = createPurl(depName, version);
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
      for (const subproject of subprojects) {
        if (subproject.scopes) {
          const allDeps = new Set<string>();
          for (const scope of subproject.scopes) {
            for (const pkg of scope.packages) {
              allDeps.add(pkg);
            }
          }

          if (allDeps.size > 0) {
            const existing = relationshipsMap.get(subproject.purl);
            if (existing) {
              allDeps.forEach((dep) => existing.add(dep));
            } else {
              relationshipsMap.set(subproject.purl, allDeps);
            }
          }
        }
      }
    } catch (error) {
      // Silently skip files that fail to parse
    }

    // Convert maps to arrays
    const packages = Array.from(packageMap.values()).map(({ purl, evidence }) => ({
      purl,
      evidence: Array.from(evidence),
    }));

    const relationships: Relationship[] = Array.from(relationshipsMap.entries()).map(([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    }));

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
  for (const depType of DEPENDENCY_TYPES) {
    const depsInScope = deps[depType];
    if (depsInScope && typeof depsInScope === 'object') {
      for (const [depName, depVersion] of Object.entries(depsInScope)) {
        if (typeof depVersion === 'string') {
          const cleanVersion = stripPeerDepSuffix(depVersion);
          const depPurl = createPurl(depName, cleanVersion);

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

      const purl = createPurl(name, version);

      // Add package with evidence
      if (!packageMap.has(purl)) {
        packageMap.set(purl, { purl, evidence: new Set() });
      }

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
      const purl = createPurl(name, version);

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

    const purl = createPurl(name, version);

    // Add package with evidence
    if (!packageMap.has(purl)) {
      packageMap.set(purl, { purl, evidence: new Set() });
    }

    const lineNumber = findLineNumber(lockfileContent, packageKey);
    if (lineNumber) {
      packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
    }

    // Extract relationships from dependencies
    processDependencies(packageEntry, purl, packageMap, relationshipsMap);
  }
}

/**
 * Add a relationship to the relationships map
 */
function addRelationship(relationshipsMap: Map<string, Set<string>>, from: string, to: string): void {
  const existing = relationshipsMap.get(from);
  if (existing) {
    existing.add(to);
  } else {
    relationshipsMap.set(from, new Set([to]));
  }
}

/**
 * Ensure a package exists in the package map
 */
function ensurePackageExists(packageMap: Map<string, { purl: string; evidence: Set<string> }>, purl: string): void {
  if (!packageMap.has(purl)) {
    packageMap.set(purl, { purl, evidence: new Set() });
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

// Helper to create PURL from name and version
function createPurl(name: string, version: string): string {
  let namespace: string | null = null;
  let packageName = name;

  if (name.startsWith('@')) {
    const parts = name.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      namespace = parts[0];
      packageName = parts[1];
    }
  }

  return new PackageURL('npm', namespace, packageName, version, null, null).toString();
}
