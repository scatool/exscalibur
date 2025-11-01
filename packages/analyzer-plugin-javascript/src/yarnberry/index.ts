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
  parsePackagePattern,
  parseYarnBerryLockfile,
  resolvePackageVersion,
  type YarnBerryLockfile,
} from './lockfile.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/yarn.lock');

const DEPENDENCY_TYPES = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

export const extractor: Extractor = filesExtractor({
  name: 'yarnberry',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/node_modules/')) {
        // Only mark Yarn Berry lockfiles (version 8+)
        // Check if the file contains "version: 8" or higher in the metadata section
        try {
          const content = await Bun.file(file).text();
          if (content.includes('__metadata:') && /version:\s+[8-9]\d*/.test(content)) {
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
      const lockfile = parseYarnBerryLockfile(lockfileContent);

      // Find all workspace packages by looking for linkType: soft
      const workspacePackages = new Map<string, { version: string; path: string }>();
      const workspacePatterns = new Map<string, string>(); // Map package name to workspace path

      for (const [pattern, pkg] of lockfile.packages.entries()) {
        // Check if this is a workspace package (linkType: soft)
        if (pkg.linkType === 'soft') {
          const parsed = parsePackagePattern(pattern);
          if (parsed && parsed.type === 'workspace') {
            // This is the workspace: pattern - store the path
            workspacePatterns.set(parsed.name, parsed.versionOrPath);
          }
        }
      }

      // Now read package.json files for all workspace packages
      for (const [name, path] of workspacePatterns.entries()) {
        const workspaceDir = path === '.' ? dir : join(dir, path);
        const packageJsonPath = join(workspaceDir, 'package.json');

        try {
          const packageJsonContent = await Bun.file(packageJsonPath).text();
          const packageInfo = JSON.parse(packageJsonContent) as PackageJson;
          if (packageInfo.version) {
            workspacePackages.set(name, {
              version: packageInfo.version,
              path,
            });
          }
        } catch {
          // Skip if package.json doesn't exist or is invalid
          continue;
        }
      }

      // Process workspace packages to create subprojects
      for (const [name, info] of workspacePackages.entries()) {
        // Find the workspace package entry in the lockfile
        const workspacePattern = `${name}@workspace:${info.path}`;
        const pkg = lockfile.packages.get(workspacePattern);
        if (!pkg) continue;

        const workspaceDir = info.path === '.' ? dir : join(dir, info.path);
        const packageJsonPath = join(workspaceDir, 'package.json');

        // Create PURL for this subproject
        const purl = createPurl(name, info.version);

        // Extract scopes - read from package.json to preserve original dependency types
        // (Yarn Berry lockfile normalizes all deps to just "dependencies")
        const scopes: DependencyScope[] = [];
        const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

        // Read package.json to get the original dependency scopes
        let packageInfo: PackageJson | null = null;
        try {
          const packageJsonContent = await Bun.file(packageJsonPath).text();
          packageInfo = JSON.parse(packageJsonContent) as PackageJson;
        } catch {
          // If we can't read package.json, skip this subproject
          continue;
        }

        for (const scopeName of scopeNames) {
          const depsInScope: string[] = [];
          const packageJsonDeps = packageInfo[scopeName];

          if (packageJsonDeps && typeof packageJsonDeps === 'object') {
            for (const [depName, versionRange] of Object.entries(packageJsonDeps)) {
              if (typeof versionRange === 'string') {
                // Check if this is a workspace package
                const workspaceVersion = workspacePackages.get(depName);
                if (workspaceVersion) {
                  const depPurl = createPurl(depName, workspaceVersion.version);
                  depsInScope.push(depPurl);
                  continue;
                }

                // Regular external dependency - resolve the version
                const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
                if (resolvedVersion) {
                  const depPurl = createPurl(depName, resolvedVersion);
                  depsInScope.push(depPurl);
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

      // If no workspace packages found, check if this is a single-package project
      if (subprojects.length === 0) {
        const packageJsonPath = join(dir, 'package.json');

        try {
          const packageJsonContent = await Bun.file(packageJsonPath).text();
          const packageInfo = JSON.parse(packageJsonContent) as PackageJson;

          if (packageInfo.name && packageInfo.version) {
            const purl = createPurl(packageInfo.name, packageInfo.version);

            // Extract scopes from package.json
            const scopes: DependencyScope[] = [];
            const scopeNames = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

            for (const scopeName of scopeNames) {
              const depsInScope: string[] = [];
              const deps = packageInfo[scopeName];

              if (deps && typeof deps === 'object') {
                for (const [depName, versionRange] of Object.entries(deps)) {
                  if (typeof versionRange === 'string') {
                    // Resolve the actual installed version from the lockfile
                    const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
                    if (resolvedVersion) {
                      const depPurl = createPurl(depName, resolvedVersion);
                      depsInScope.push(depPurl);
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
        } catch {
          // Skip if package.json doesn't exist or is invalid
        }
      }

      // Process all packages to extract packages and relationships
      for (const [pattern, pkg] of lockfile.packages.entries()) {
        const parsed = parsePackagePattern(pattern);
        if (!parsed) continue;

        // Skip workspace packages - they're not external dependencies
        if (parsed.type === 'workspace') continue;

        const { name } = parsed;
        const version = pkg.version;

        // Skip if no version
        if (!version) continue;

        const purl = createPurl(name, version);

        // Add package with evidence
        if (!packageMap.has(purl)) {
          packageMap.set(purl, { purl, evidence: new Set() });
        }

        const lineNumber = findLineNumber(lockfileContent, pattern);
        if (lineNumber) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Extract relationships from dependencies
        processDependencies(pkg, purl, lockfile, packageMap, relationshipsMap);
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
    peerDependencies?: Record<string, string>;
  },
  purl: string,
  lockfile: YarnBerryLockfile,
  packageMap: Map<string, { purl: string; evidence: Set<string> }>,
  relationshipsMap: Map<string, Set<string>>,
): void {
  for (const depType of DEPENDENCY_TYPES) {
    const depsInScope = deps[depType];
    if (depsInScope && typeof depsInScope === 'object') {
      for (const [depName, depRef] of Object.entries(depsInScope)) {
        if (typeof depRef === 'string') {
          // Extract the version range from npm: prefix
          let versionRange = depRef;
          if (versionRange.startsWith('npm:')) {
            versionRange = versionRange.substring(4);
          }

          // Resolve to the actual installed version
          const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
          if (resolvedVersion) {
            const depPurl = createPurl(depName, resolvedVersion);

            addRelationship(relationshipsMap, purl, depPurl);
            ensurePackageExists(packageMap, depPurl);
          }
        }
      }
    }
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
