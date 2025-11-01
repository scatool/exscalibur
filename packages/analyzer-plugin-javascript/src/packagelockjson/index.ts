import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Relationship,
  type Subproject,
  filesExtractor,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path';
import {
  extractPackageName,
  findLineNumber,
  isWorkspacePath,
  parsePackageLock,
  type PackageLockPackage,
} from './lockfile.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/{package-lock.json,npm-shrinkwrap.json}');

const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

export const extractor: Extractor = filesExtractor({
  name: 'packagelockjson',
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
      const lockfile = parsePackageLock(lockfileContent);

      // Lockfile v1 doesn't have packages section, skip it
      if (!lockfile.packages || lockfile.lockfileVersion < 2) {
        console.warn(`Skipping lockfile ${file}: lockfileVersion ${lockfile.lockfileVersion} not supported`);
        return { packages: [], subprojects: [], relationships: [] };
      }

      // Build maps for package resolution
      // Map from package name to resolved versions (for resolving dependency references)
      const packageVersionMap = new Map<string, Map<string, string>>(); // name -> versionRange -> resolvedVersion

      // First pass: collect all packages and build version resolution map
      for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
        if (!packageEntry.version) continue;

        // Skip root and workspace packages for the version map (they're not regular dependencies)
        if (packagePath === '' || isWorkspacePath(packagePath)) continue;

        const packageName = extractPackageName(packagePath);
        if (!packageName) continue;

        // Store this package version
        if (!packageVersionMap.has(packageName)) {
          packageVersionMap.set(packageName, new Map());
        }

        // We'll use this to resolve dependencies later
        // For now, just map the exact version to itself
        const versionMap = packageVersionMap.get(packageName);
        if (versionMap) {
          versionMap.set(packageEntry.version, packageEntry.version);
        }
      }

      // Process workspace packages to build a map of workspace names
      const workspacePackages = new Map<string, { version: string; path: string }>();

      for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
        if (isWorkspacePath(packagePath)) {
          // Read package.json for this workspace
          const packageJsonPath = join(dir, packagePath, 'package.json');
          try {
            const packageJsonContent = await Bun.file(packageJsonPath).text();
            const packageInfo = JSON.parse(packageJsonContent) as PackageJson;
            if (packageInfo.name && packageInfo.version) {
              workspacePackages.set(packageInfo.name, {
                version: packageInfo.version,
                path: packagePath,
              });
            }
          } catch {
            // Skip invalid workspace packages
          }
        }
      }

      // Extract root package as subproject if it has name and version
      const rootPackage = lockfile.packages[''];
      if (rootPackage) {
        const packageJsonPath = join(dir, 'package.json');
        try {
          const packageJsonContent = await Bun.file(packageJsonPath).text();
          const packageInfo = JSON.parse(packageJsonContent) as PackageJson;

          if (packageInfo.name && packageInfo.version) {
            const rootPurl = createPurl(packageInfo.name, packageInfo.version);

            // Extract scopes for the root package
            const rootScopes = extractScopes(
              packageInfo,
              rootPackage,
              lockfile.packages,
              packageVersionMap,
              workspacePackages,
            );

            subprojects.push({
              purl: rootPurl,
              definitionFile: packageJsonPath,
              scopes: rootScopes,
            });
          }
        } catch {
          // Skip if package.json doesn't exist
        }
      }

      // Extract workspace packages as subprojects
      for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
        if (isWorkspacePath(packagePath)) {
          const packageJsonPath = join(dir, packagePath, 'package.json');

          try {
            const packageJsonContent = await Bun.file(packageJsonPath).text();
            const packageInfo = JSON.parse(packageJsonContent) as PackageJson;

            if (packageInfo.name && packageInfo.version) {
              const purl = createPurl(packageInfo.name, packageInfo.version);

              // Extract scopes
              const scopes = extractScopes(
                packageInfo,
                packageEntry,
                lockfile.packages,
                packageVersionMap,
                workspacePackages,
              );

              subprojects.push({
                purl,
                definitionFile: packageJsonPath,
                scopes,
              });
            }
          } catch {
            // Skip invalid package.json
          }
        }
      }

      // Process all packages (excluding root and workspaces) for packages and relationships
      for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
        // Skip root package
        if (packagePath === '') continue;

        // Skip workspace packages (they're subprojects, not regular packages)
        if (isWorkspacePath(packagePath)) continue;

        const packageName = extractPackageName(packagePath);
        if (!packageName) continue;

        const version = packageEntry.version;
        if (!version) continue;

        // Use the actual package name from the entry if available (handles aliases)
        const actualName = packageEntry.name || packageName;
        const purl = createPurl(actualName, version);

        // Add package with evidence
        if (!packageMap.has(purl)) {
          packageMap.set(purl, { purl, evidence: new Set() });
        }

        // Find line number for evidence
        const lineNumber = findLineNumber(lockfileContent, packagePath, version);
        if (lineNumber) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Extract relationships from this package's dependencies
        processDependencies(
          packageEntry,
          purl,
          lockfile.packages,
          packageVersionMap,
          workspacePackages,
          packageMap,
          relationshipsMap,
        );
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
      console.error(`Failed to parse ${file}:`, error);
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
    };
  },
});

/**
 * Extract dependency scopes from package.json and resolve versions from lockfile
 */
function extractScopes(
  packageInfo: PackageJson,
  lockfileEntry: PackageLockPackage,
  allPackages: Record<string, PackageLockPackage>,
  packageVersionMap: Map<string, Map<string, string>>,
  workspacePackages: Map<string, { version: string; path: string }>,
): DependencyScope[] {
  const scopes: DependencyScope[] = [];
  const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

  for (const scopeName of scopeNames) {
    const scopeDeps = packageInfo[scopeName];
    if (!scopeDeps || typeof scopeDeps !== 'object') continue;

    const scopePackages: string[] = [];

    for (const [depName, versionRange] of Object.entries(scopeDeps)) {
      if (typeof versionRange !== 'string') continue;

      // Check if this is a workspace package
      const workspaceInfo = workspacePackages.get(depName);
      if (workspaceInfo) {
        // This is a workspace package - use its version
        const depPurl = createPurl(depName, workspaceInfo.version);
        scopePackages.push(depPurl);
        continue;
      }

      // Resolve the version from the lockfile entry's dependencies
      const resolvedVersion = resolveVersion(
        depName,
        versionRange,
        lockfileEntry,
        allPackages,
        packageVersionMap,
      );

      if (resolvedVersion) {
        const depPurl = createPurl(depName, resolvedVersion);
        scopePackages.push(depPurl);
      }
    }

    if (scopePackages.length > 0) {
      scopes.push({
        scope: scopeName,
        packages: scopePackages,
      });
    }
  }

  return scopes;
}

/**
 * Process dependencies from a package entry and add relationships
 */
function processDependencies(
  packageEntry: PackageLockPackage,
  purl: string,
  allPackages: Record<string, PackageLockPackage>,
  packageVersionMap: Map<string, Map<string, string>>,
  workspacePackages: Map<string, { version: string; path: string }>,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  for (const depType of DEPENDENCY_TYPES) {
    const depsInScope = packageEntry[depType];
    if (!depsInScope || typeof depsInScope !== 'object') continue;

    for (const [depName, versionRange] of Object.entries(depsInScope)) {
      if (typeof versionRange !== 'string') continue;

      // Check if this is a workspace package
      const workspaceInfo = workspacePackages.get(depName);
      if (workspaceInfo) {
        // Don't create relationships to workspace packages
        continue;
      }

      // Resolve the actual installed version
      const resolvedVersion = resolveVersion(
        depName,
        versionRange,
        packageEntry,
        allPackages,
        packageVersionMap,
      );

      if (resolvedVersion) {
        const depPurl = createPurl(depName, resolvedVersion);

        // Add relationship
        addRelationship(relationshipsMap, purl, depPurl);

        // Ensure package exists
        ensurePackageExists(packageMap, depPurl);
      }
    }
  }
}

/**
 * Resolve a dependency's version from the lockfile
 * This handles nested dependencies and version ranges
 */
function resolveVersion(
  depName: string,
  versionRange: string,
  packageEntry: PackageLockPackage,
  allPackages: Record<string, PackageLockPackage>,
  packageVersionMap: Map<string, Map<string, string>>,
): string | null {
  // Look in the lockfile's dependencies section for this package's resolved version
  // The lockfile entry's dependencies contain version ranges that point to the exact versions

  // Try to find a package entry that matches this dependency
  // First, check direct node_modules
  const directPath = `node_modules/${depName}`;
  if (allPackages[directPath]?.version) {
    return allPackages[directPath].version!;
  }

  // For scoped packages or nested dependencies, we need to search more carefully
  // Look through all packages to find one with matching name
  const versionMap = packageVersionMap.get(depName);
  if (versionMap) {
    // Try exact version match first
    if (versionMap.has(versionRange)) {
      return versionMap.get(versionRange)!;
    }

    // If there's only one version, use it
    if (versionMap.size === 1) {
      const versions = Array.from(versionMap.values());
      if (versions[0]) {
        return versions[0];
      }
    }
  }

  // Fallback: search all packages for this name
  for (const [path, pkg] of Object.entries(allPackages)) {
    if (path === '' || isWorkspacePath(path)) continue;

    const pkgName = extractPackageName(path);
    if (pkgName === depName && pkg.version) {
      return pkg.version;
    }
  }

  return null;
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
 * Create a PURL from package name and version
 */
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
