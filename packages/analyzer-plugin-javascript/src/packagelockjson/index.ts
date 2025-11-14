import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
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
  extractPackageName,
  findLineNumber,
  findLineNumberV1,
  isWorkspacePath,
  parsePackageLock,
  type LockfileV1Dependency,
  type PackageLockPackage,
} from './lockfile.ts';
import type { PackageJson } from '../types.ts';
import { createNpmPurl, NPM_DEPENDENCY_SCOPES } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'packagelockjson',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/{package-lock.json,npm-shrinkwrap.json}');
    for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    try {
      const lockfileContent = await Bun.file(file).text();
      const lockfile = parsePackageLock(lockfileContent);

      // Route to appropriate extraction logic based on lockfile version
      if (lockfile.lockfileVersion === 1) {
        return extractFromV1Lockfile(lockfile, lockfileContent, file, dir);
      } else if (lockfile.lockfileVersion >= 2 && lockfile.packages) {
        return extractFromV2Lockfile(lockfile, lockfileContent, file, dir);
      } else {
        console.warn(`Skipping lockfile ${file}: lockfileVersion ${lockfile.lockfileVersion} not supported`);
        return { packages: [], subprojects: [], relationships: [], issues: [] };
      }
    } catch (error) {
      // Silently skip files that fail to parse
      console.error(`Failed to parse ${file}:`, error);
      return { packages: [], subprojects: [], relationships: [], issues: [] };
    }
  },
});

/**
 * Extract packages, subprojects, and relationships from lockfile v1
 */
async function extractFromV1Lockfile(
  lockfile: ReturnType<typeof parsePackageLock>,
  lockfileContent: string,
  file: string,
  dir: string,
): Promise<AnalyzerResult> {
  const { packageMap, relationshipsMap } = initializeExtractionMaps();
  const subprojects: Subproject[] = [];

  if (!lockfile.dependencies) {
    return { packages: [], subprojects: [], relationships: [], issues: [] };
  }

  // Traverse the dependency tree and collect all packages
  const traverseDependencies = (deps: Record<string, LockfileV1Dependency>, parentPath: string[] = []): void => {
    for (const [packageName, depEntry] of Object.entries(deps)) {
      const version = depEntry.version;
      const purl = createNpmPurl(packageName, version);

      // Add package with evidence
      if (!packageMap.has(purl)) {
        packageMap.set(purl, { purl, evidence: new Set() });
      }

      // Find line number for evidence
      const lineNumber = findLineNumberV1(lockfileContent, packageName, version);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Extract relationships from this package's dependencies
      if (depEntry.requires) {
        for (const [depName, versionRange] of Object.entries(depEntry.requires)) {
          // Resolve the version - check if it's in nested dependencies first
          let resolvedVersion: string | null = null;

          if (depEntry.dependencies && depEntry.dependencies[depName]) {
            resolvedVersion = depEntry.dependencies[depName].version;
          } else {
            // Look in the top-level dependencies
            if (deps[depName]) {
              resolvedVersion = deps[depName].version;
            } else if (lockfile.dependencies && lockfile.dependencies[depName]) {
              resolvedVersion = lockfile.dependencies[depName].version;
            }
          }

          if (resolvedVersion) {
            const depPurl = createNpmPurl(depName, resolvedVersion);
            addRelationship(relationshipsMap, purl, depPurl);
            ensurePackageExists(packageMap, depPurl);
          }
        }
      }

      // Recursively traverse nested dependencies
      if (depEntry.dependencies) {
        traverseDependencies(depEntry.dependencies, [...parentPath, packageName]);
      }
    }
  };

  // Traverse all top-level dependencies
  traverseDependencies(lockfile.dependencies);

  // Extract root package as subproject
  const packageJsonPath = join(dir, 'package.json');
  try {
    const packageJsonContent = await Bun.file(packageJsonPath).text();
    const packageInfo = JSON.parse(packageJsonContent) as PackageJson;

    if (packageInfo.name && packageInfo.version) {
      const rootPurl = createNpmPurl(packageInfo.name, packageInfo.version);

      // Extract scopes for the root package
      const rootScopes = extractScopesV1(packageInfo, lockfile.dependencies);

      subprojects.push({
        purl: rootPurl,
        definitionFile: packageJsonPath,
        scopes: rootScopes,
      });

      // Add relationships from root to its dependencies
      if (rootScopes.length > 0) {
        const allDeps = new Set<string>();
        for (const scope of rootScopes) {
          for (const pkg of scope.packages) {
            allDeps.add(pkg);
          }
        }

        if (allDeps.size > 0) {
          relationshipsMap.set(rootPurl, allDeps);
        }
      }
    }
  } catch {
    // Skip if package.json doesn't exist
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
}

/**
 * Extract dependency scopes from package.json for lockfile v1
 */
function extractScopesV1(
  packageInfo: PackageJson,
  dependencies: Record<string, LockfileV1Dependency>,
): DependencyScope[] {
  const scopes: DependencyScope[] = [];
  const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

  for (const scopeName of scopeNames) {
    const scopeDeps = packageInfo[scopeName];
    if (!scopeDeps || typeof scopeDeps !== 'object') continue;

    const scopePackages: string[] = [];

    for (const [depName, versionRange] of Object.entries(scopeDeps)) {
      if (typeof versionRange !== 'string') continue;

      // Look up the version from the lockfile dependencies
      const depEntry = dependencies[depName];
      if (depEntry && depEntry.version) {
        const depPurl = createNpmPurl(depName, depEntry.version);
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
 * Extract packages, subprojects, and relationships from lockfile v2+
 */
async function extractFromV2Lockfile(
  lockfile: ReturnType<typeof parsePackageLock>,
  lockfileContent: string,
  file: string,
  dir: string,
): Promise<AnalyzerResult> {
  const { packageMap, relationshipsMap } = initializeExtractionMaps();
  const subprojects: Subproject[] = [];

  if (!lockfile.packages) {
    return { packages: [], subprojects: [], relationships: [], issues: [] };
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
        const rootPurl = createNpmPurl(packageInfo.name, packageInfo.version);

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
          const purl = createNpmPurl(packageInfo.name, packageInfo.version);

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
    const purl = createNpmPurl(actualName, version);

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
  aggregateSubprojectRelationships(subprojects, relationshipsMap);

  // Convert maps to arrays
  const packages = convertPackageMapToArray(packageMap);
  const relationships = convertRelationshipsMapToArray(relationshipsMap);

  return {
    packages,
    subprojects,
    relationships,
    issues: [],
  };
}

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
        const depPurl = createNpmPurl(depName, workspaceInfo.version);
        scopePackages.push(depPurl);
        continue;
      }

      // Resolve the package info from the lockfile (handles aliases)
      const packageInfoResolved = resolvePackageInfo(
        depName,
        versionRange,
        lockfileEntry,
        allPackages,
        packageVersionMap,
      );

      if (packageInfoResolved) {
        // Use the actual package name (not the alias)
        const depPurl = createNpmPurl(packageInfoResolved.name, packageInfoResolved.version);
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
  for (const depType of NPM_DEPENDENCY_SCOPES) {
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

      // Resolve the actual package info (handles aliases)
      const packageInfo = resolvePackageInfo(depName, versionRange, packageEntry, allPackages, packageVersionMap);

      if (packageInfo) {
        // Use the actual package name (not the alias)
        const depPurl = createNpmPurl(packageInfo.name, packageInfo.version);

        // Add relationship
        addRelationship(relationshipsMap, purl, depPurl);

        // Ensure package exists
        ensurePackageExists(packageMap, depPurl);
      }
    }
  }
}

/**
 * Resolve a dependency's package info (name and version) from the lockfile
 * This handles aliases where the dependency name differs from the actual package name
 */
function resolvePackageInfo(
  depName: string,
  versionRange: string,
  packageEntry: PackageLockPackage,
  allPackages: Record<string, PackageLockPackage>,
  packageVersionMap: Map<string, Map<string, string>>,
): { name: string; version: string } | null {
  // Try to find a package entry that matches this dependency
  // First, check direct node_modules
  const directPath = `node_modules/${depName}`;
  const directPackage = allPackages[directPath];
  if (directPackage?.version) {
    // Use the actual package name from the entry (handles aliases)
    const actualName = directPackage.name || depName;
    return { name: actualName, version: directPackage.version };
  }

  // For scoped packages or nested dependencies, we need to search more carefully
  // Look through all packages to find one with matching name
  const versionMap = packageVersionMap.get(depName);
  if (versionMap) {
    // Try exact version match first
    if (versionMap.has(versionRange)) {
      const version = versionMap.get(versionRange)!;
      // Need to find the actual package entry to get the real name
      for (const [path, pkg] of Object.entries(allPackages)) {
        if (path === '' || isWorkspacePath(path)) continue;
        const pkgName = extractPackageName(path);
        if (pkgName === depName && pkg.version === version) {
          const actualName = pkg.name || depName;
          return { name: actualName, version };
        }
      }
      return { name: depName, version };
    }

    // If there's only one version, use it
    if (versionMap.size === 1) {
      const versions = Array.from(versionMap.values());
      if (versions[0]) {
        const version = versions[0];
        // Find the actual package entry
        for (const [path, pkg] of Object.entries(allPackages)) {
          if (path === '' || isWorkspacePath(path)) continue;
          const pkgName = extractPackageName(path);
          if (pkgName === depName && pkg.version === version) {
            const actualName = pkg.name || depName;
            return { name: actualName, version };
          }
        }
        return { name: depName, version };
      }
    }
  }

  // Fallback: search all packages for this name
  for (const [path, pkg] of Object.entries(allPackages)) {
    if (path === '' || isWorkspacePath(path)) continue;

    const pkgName = extractPackageName(path);
    if (pkgName === depName && pkg.version) {
      const actualName = pkg.name || depName;
      return { name: actualName, version: pkg.version };
    }
  }

  return null;
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
  const info = resolvePackageInfo(depName, versionRange, packageEntry, allPackages, packageVersionMap);
  return info?.version ?? null;
}
