import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  scanAndMarkFiles,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { dirname, join } from 'node:path/posix';
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
import { createNpmPurl, extractNpmScopes, NPM_DEPENDENCY_SCOPES, readPackageJson } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'packagelockjson',
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    await scanAndMarkFiles(this, codebase, '**/{package-lock.json,npm-shrinkwrap.json}', options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const lockfileContent = (await Bun.file(file).text()).replaceAll('\r\n', '\n');
    const lockfile = parsePackageLock(lockfileContent);

    // Route to appropriate extraction logic based on lockfile version
    if (lockfile.lockfileVersion === 1) {
      return extractFromV1Lockfile(lockfile, lockfileContent, file, dir);
    } else if (lockfile.lockfileVersion >= 2 && lockfile.packages) {
      return extractFromV2Lockfile(lockfile, lockfileContent, file, dir);
    } else {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            message: `Unsupported lockfileVersion ${lockfile.lockfileVersion}`,
            severity: 'WARNING',
            file,
          },
        ],
      };
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
      ensurePackageExists(packageMap, purl);

      // Find line number for evidence
      const lineNumber = findLineNumberV1(lockfileContent, packageName, version);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Extract relationships from this package's dependencies
      if (depEntry.requires) {
        for (const [depName] of Object.entries(depEntry.requires)) {
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
  const packageInfo = await readPackageJson(packageJsonPath);
  if (packageInfo?.name && packageInfo.version) {
    const rootPurl = createNpmPurl(packageInfo.name, packageInfo.version);
    const rootScopes = extractScopesV1(packageInfo, lockfile.dependencies);

    subprojects.push({
      purl: rootPurl,
      definitionFile: packageJsonPath,
      scopes: rootScopes,
    });
  }

  return buildResult(packageMap, relationshipsMap, subprojects);
}

function extractScopesV1(
  packageInfo: PackageJson,
  dependencies: Record<string, LockfileV1Dependency>,
): DependencyScope[] {
  return extractNpmScopes(packageInfo as Record<string, unknown>, (depName) => {
    const depEntry = dependencies[depName];
    return depEntry?.version ? createNpmPurl(depName, depEntry.version) : null;
  });
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

  // Process workspace packages to build a map of workspace names
  const workspacePackages = new Map<string, { version: string; path: string }>();

  for (const [packagePath] of Object.entries(lockfile.packages)) {
    if (isWorkspacePath(packagePath)) {
      const packageJsonPath = join(dir, packagePath, 'package.json');
      const packageInfo = await readPackageJson(packageJsonPath);
      if (packageInfo?.name && packageInfo.version) {
        workspacePackages.set(packageInfo.name, {
          version: packageInfo.version,
          path: packagePath,
        });
      }
    }
  }

  // Extract root package as subproject if it has name and version
  const rootPackage = lockfile.packages[''];
  if (rootPackage) {
    const packageJsonPath = join(dir, 'package.json');
    const rootPackageInfo = await readPackageJson(packageJsonPath);
    if (rootPackageInfo?.name && rootPackageInfo.version) {
      const rootPurl = createNpmPurl(rootPackageInfo.name, rootPackageInfo.version);
      const rootScopes = extractScopes(rootPackageInfo, lockfile.packages, workspacePackages);

      subprojects.push({
        purl: rootPurl,
        definitionFile: packageJsonPath,
        scopes: rootScopes,
      });
    }
  }

  // Extract workspace packages as subprojects
  for (const [packagePath] of Object.entries(lockfile.packages)) {
    if (isWorkspacePath(packagePath)) {
      const packageJsonPath = join(dir, packagePath, 'package.json');
      const packageInfo = await readPackageJson(packageJsonPath);
      if (packageInfo?.name && packageInfo.version) {
        const purl = createNpmPurl(packageInfo.name, packageInfo.version);
        const scopes = extractScopes(packageInfo, lockfile.packages, workspacePackages, packagePath);

        subprojects.push({
          purl,
          definitionFile: packageJsonPath,
          scopes,
        });
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
    ensurePackageExists(packageMap, purl);

    // Find line number for evidence
    const lineNumber = findLineNumber(lockfileContent, packagePath, version);
    if (lineNumber) {
      packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
    }

    // Extract relationships from this package's dependencies
    processDependencies(
      packageEntry,
      packagePath,
      purl,
      lockfile.packages,
      workspacePackages,
      packageMap,
      relationshipsMap,
    );
  }

  return buildResult(packageMap, relationshipsMap, subprojects);
}

function extractScopes(
  packageInfo: PackageJson,
  allPackages: Record<string, PackageLockPackage>,
  workspacePackages: Map<string, { version: string; path: string }>,
  callerPath: string = '',
): DependencyScope[] {
  return extractNpmScopes(packageInfo as Record<string, unknown>, (depName) => {
    const workspaceInfo = workspacePackages.get(depName);
    if (workspaceInfo) return createNpmPurl(depName, workspaceInfo.version);

    const resolved = resolvePackageInfo(depName, allPackages, callerPath);
    return resolved ? createNpmPurl(resolved.name, resolved.version) : null;
  });
}

/**
 * Process dependencies from a package entry and add relationships
 */
function processDependencies(
  packageEntry: PackageLockPackage,
  packagePath: string,
  purl: string,
  allPackages: Record<string, PackageLockPackage>,
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
      const packageInfo = resolvePackageInfo(depName, allPackages, packagePath);

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
 * Resolve a dependency's package info (name and version) from the lockfile.
 * Follows npm's node_modules resolution algorithm: walk up from the caller's
 * path, checking nested node_modules at each level before falling back to
 * the top-level.
 */
function resolvePackageInfo(
  depName: string,
  allPackages: Record<string, PackageLockPackage>,
  callerPath: string,
): { name: string; version: string } | null {
  const candidates = buildResolutionCandidates(callerPath, depName);

  for (const candidate of candidates) {
    const pkg = allPackages[candidate];
    if (pkg?.version) {
      const actualName = pkg.name || depName;
      return { name: actualName, version: pkg.version };
    }
  }

  return null;
}

/**
 * Build the list of candidate paths to check for a dependency, following
 * npm's resolution order (nearest node_modules first, then walking up).
 *
 * For callerPath "node_modules/a/node_modules/b" and depName "x":
 *   1. node_modules/a/node_modules/b/node_modules/x
 *   2. node_modules/a/node_modules/x
 *   3. node_modules/x
 */
function buildResolutionCandidates(callerPath: string, depName: string): string[] {
  const candidates: string[] = [];

  if (callerPath === '') {
    candidates.push(`node_modules/${depName}`);
    return candidates;
  }

  // First candidate: nested directly under the caller
  candidates.push(`${callerPath}/node_modules/${depName}`);

  // Walk up by stripping the last /node_modules/<pkg> segment each time
  let current = callerPath;
  while (true) {
    const idx = current.lastIndexOf('/node_modules/');
    if (idx === -1) {
      // Reached the top level - always fall back to hoisted node_modules
      candidates.push(`node_modules/${depName}`);
      break;
    }
    current = current.substring(0, idx);
    candidates.push(`${current}/node_modules/${depName}`);
  }

  return candidates;
}
