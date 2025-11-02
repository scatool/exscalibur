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
import { findLineNumber, parsePackagePattern, parseYarnLockfile, resolvePackageVersion } from './lockfile.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/yarn.lock');

const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

export const extractor: Extractor = filesExtractor({
  name: 'yarnlock',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/node_modules/')) {
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

    const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
    const relationshipsMap = new Map<string, Set<string>>();
    const subprojects: Subproject[] = [];

    try {
      const lockfileContent = await Bun.file(file).text();
      const lockfile = parseYarnLockfile(lockfileContent);

      // Read root package.json to determine workspace setup
      const packageJsonPath = join(dir, 'package.json');
      let rootPackageInfo: PackageJson | null = null;
      try {
        const packageJsonContent = await Bun.file(packageJsonPath).text();
        rootPackageInfo = JSON.parse(packageJsonContent) as PackageJson;
      } catch {
        // package.json might not exist, continue anyway
      }

      // Collect workspace package.json files if this is a workspace root
      const workspacePackageJsonPaths: string[] = [];
      const isWorkspaceRoot = rootPackageInfo?.workspaces && Array.isArray(rootPackageInfo.workspaces);

      if (isWorkspaceRoot && rootPackageInfo) {
        const workspacePatterns = rootPackageInfo.workspaces as string[];
        for (const pattern of workspacePatterns) {
          // Convert workspace pattern to a glob pattern for package.json
          const pkgJsonPattern = pattern.endsWith('/*') ? `${pattern}/package.json` : `${pattern}/package.json`;
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
          try {
            const pkgContent = await Bun.file(pkgJsonPath).text();
            const pkgInfo = JSON.parse(pkgContent) as PackageJson;
            if (pkgInfo.name && pkgInfo.version) {
              workspacePackages.set(pkgInfo.name, pkgInfo.version);
            }
          } catch {
            // Skip invalid package.json files
            continue;
          }
        }
      }

      // Helper to extract scopes from package.json
      const extractScopesFromPackageJson = (packageInfo: PackageJson): DependencyScope[] => {
        const scopes: DependencyScope[] = [];
        const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

        for (const scopeName of scopeNames) {
          const scopeDeps = packageInfo[scopeName];
          if (scopeDeps && typeof scopeDeps === 'object') {
            const scopePackages: string[] = [];

            for (const [depName, versionRange] of Object.entries(scopeDeps)) {
              if (typeof versionRange !== 'string') continue;

              // Skip workspace protocol and link: dependencies (but not "*" which might be workspace)
              if (versionRange.startsWith('workspace:') || versionRange.startsWith('link:')) {
                continue;
              }

              // Check if this is a workspace package (by name)
              const workspaceVersion = workspacePackages.get(depName);
              if (workspaceVersion) {
                // This is a workspace package - use its version
                const depPurl = createPurl(depName, workspaceVersion);
                scopePackages.push(depPurl);
                continue;
              }

              // Resolve the actual installed version from the lockfile
              const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
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
        }

        return scopes;
      };

      // Create subproject for root package if it has name and version
      if (rootPackageInfo?.name && rootPackageInfo?.version) {
        const rootPurl = createPurl(rootPackageInfo.name, rootPackageInfo.version);
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
          try {
            const pkgContent = await Bun.file(pkgJsonPath).text();
            const pkgInfo = JSON.parse(pkgContent) as PackageJson;

            if (pkgInfo.name && pkgInfo.version) {
              const purl = createPurl(pkgInfo.name, pkgInfo.version);
              const scopes = extractScopesFromPackageJson(pkgInfo);

              subprojects.push({
                purl,
                definitionFile: pkgJsonPath,
                scopes,
              });
            }
          } catch {
            // Skip invalid package.json files
            continue;
          }
        }
      }

      // Process all packages in the lockfile
      const processedPackages = new Set<string>(); // Track unique package@version to avoid duplicates

      for (const [pattern, packageEntry] of lockfile.packages.entries()) {
        const parsed = parsePackagePattern(pattern);
        if (!parsed) continue;

        const { name, versionRange } = parsed;
        const version = packageEntry.version;

        if (!version) continue;

        // Create a unique key for this package
        const packageKey = `${name}@${version}`;
        if (processedPackages.has(packageKey)) {
          continue; // Already processed this exact package
        }
        processedPackages.add(packageKey);

        const purl = createPurl(name, version);

        // Add package with evidence
        if (!packageMap.has(purl)) {
          packageMap.set(purl, { purl, evidence: new Set() });
        }

        const lineNumber = findLineNumber(lockfileContent, lockfile, name, version);
        if (lineNumber) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Extract relationships from dependencies
        processDependencies(packageEntry, purl, lockfile, packageMap, relationshipsMap);
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

    const depPurl = createPurl(depName, resolvedVersion);

    addRelationship(relationshipsMap, purl, depPurl);
    ensurePackageExists(packageMap, depPurl);
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
