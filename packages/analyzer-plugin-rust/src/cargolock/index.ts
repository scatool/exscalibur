import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  addPackageEvidence,
  buildResult,
  initializeExtractionMaps,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { dirname, join } from 'node:path';
import {
  findLineNumber,
  isWorkspacePackage,
  parseCargoLockfile,
  parseCargoToml,
  parseDependency,
  type CargoLockPackage,
} from './lockfile.ts';
import { createCargoPurl } from '../cargo-utils.ts';
import type { RustOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

export const extractor: Extractor<RustOptions> = filesExtractor<RustOptions>({
  name: 'cargolock',
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: RustOptions) {
    await scanAndMarkFiles(this, codebase, '**/Cargo.lock', options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const lockfileContent = await Bun.file(file).text();
    const lockfile = parseCargoLockfile(lockfileContent);

    // Build a map of package names to their packages (for resolving dependencies)
    // There can be multiple versions of the same package
    const packagesByName = new Map<string, CargoLockPackage[]>();
    for (const pkg of lockfile.package || []) {
      const existing = packagesByName.get(pkg.name);
      if (existing) {
        existing.push(pkg);
      } else {
        packagesByName.set(pkg.name, [pkg]);
      }
    }

    // Determine workspace members by checking Cargo.toml
    const cargoTomlPath = join(dir, 'Cargo.toml');
    let workspaceMembers: string[] = [];
    let rootPackageName: string | undefined;
    let rootPackageVersion: string | undefined;

    try {
      const cargoTomlContent = await Bun.file(cargoTomlPath).text();
      const cargoToml = parseCargoToml(cargoTomlContent);

      if (cargoToml.workspace?.members) {
        workspaceMembers = cargoToml.workspace.members;
      }

      if (cargoToml.package?.name) {
        rootPackageName = cargoToml.package.name;
        rootPackageVersion = cargoToml.package.version;
      }
    } catch {
      // Cargo.toml might not exist or be invalid
    }

    // Build a map of workspace package names to their versions
    const workspacePackages = new Map<string, string>();
    for (const pkg of lockfile.package || []) {
      if (isWorkspacePackage(pkg)) {
        workspacePackages.set(pkg.name, pkg.version);
      }
    }

    // Process workspace members to create subprojects
    if (workspaceMembers.length > 0) {
      for (const member of workspaceMembers) {
        const memberDir = join(dir, member);
        const memberCargoTomlPath = join(memberDir, 'Cargo.toml');

        try {
          const memberCargoTomlContent = await Bun.file(memberCargoTomlPath).text();
          const memberCargoToml = parseCargoToml(memberCargoTomlContent);

          if (memberCargoToml.package?.name && memberCargoToml.package?.version) {
            const purl = createCargoPurl(memberCargoToml.package.name, memberCargoToml.package.version);

            // Find this package in the lockfile to get its dependencies
            const pkg = (lockfile.package || []).find(
              (p) => p.name === memberCargoToml.package!.name && p.version === memberCargoToml.package!.version,
            );

            const scopes = extractScopes(pkg, packagesByName);

            subprojects.push({
              purl,
              definitionFile: memberCargoTomlPath,
              scopes,
            });
          }
        } catch {
          // Skip invalid Cargo.toml files
          continue;
        }
      }
    } else if (rootPackageName && rootPackageVersion) {
      // Single package project (not a workspace)
      const purl = createCargoPurl(rootPackageName, rootPackageVersion);

      // Find this package in the lockfile to get its dependencies
      const pkg = (lockfile.package || []).find((p) => p.name === rootPackageName && p.version === rootPackageVersion);

      const scopes = extractScopes(pkg, packagesByName);

      subprojects.push({
        purl,
        definitionFile: cargoTomlPath,
        scopes,
      });
    }

    // Process all packages in the lockfile
    for (const pkg of lockfile.package || []) {
      // Skip workspace packages - they are subprojects, not dependencies
      if (isWorkspacePackage(pkg)) {
        continue;
      }

      const purl = createCargoPurl(pkg.name, pkg.version);

      // Add package to map
      ensurePackageExists(packageMap, purl);

      // Add evidence (file path and line number)
      const lineNumber = findLineNumber(lockfileContent, pkg.name);
      if (lineNumber !== undefined) {
        addPackageEvidence(packageMap, purl, `${file}#${lineNumber}`);
      }

      // Process dependencies
      if (pkg.dependencies) {
        for (const dep of pkg.dependencies) {
          const parsed = parseDependency(dep);

          // Find the matching package in the lockfile
          const depPackages = packagesByName.get(parsed.name);
          if (depPackages) {
            const depPkg = findMatchingPackage(depPackages, parsed.version, parsed.source);

            if (depPkg) {
              const depPurl = createCargoPurl(depPkg.name, depPkg.version);
              addRelationship(relationshipsMap, purl, depPurl);
              ensurePackageExists(packageMap, depPurl);
            }
          }
        }
      }
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

/**
 * Find a matching package from a list of packages with the same name.
 * Uses version and source to disambiguate when there are multiple versions
 * or packages from different sources.
 */
function findMatchingPackage(
  packages: CargoLockPackage[],
  version?: string,
  source?: string,
): CargoLockPackage | undefined {
  // If source is specified, use it for exact matching
  if (source) {
    return packages.find((p) => p.version === version && p.source === source);
  }

  // If version is specified, find by version
  // When there are multiple packages with the same version but different sources,
  // prefer the path dependency (no source) over registry dependencies
  if (version) {
    const versionMatches = packages.filter((p) => p.version === version);
    if (versionMatches.length === 1) {
      return versionMatches[0];
    }
    // If multiple matches, prefer path dependency (no source field)
    return versionMatches.find((p) => !p.source) ?? versionMatches[0];
  }

  // No version specified, use the first/only package
  return packages[0];
}

/**
 * Extract dependency scopes from a package
 * Cargo doesn't distinguish between dependency types in the lockfile,
 * so we use a single "dependencies" scope
 */
function extractScopes(
  pkg: CargoLockPackage | undefined,
  packagesByName: Map<string, CargoLockPackage[]>,
): DependencyScope[] {
  if (!pkg || !pkg.dependencies || pkg.dependencies.length === 0) {
    return [];
  }

  const scopePackages = new Set<string>();

  for (const dep of pkg.dependencies) {
    const parsed = parseDependency(dep);

    // Find the matching package in the lockfile
    const depPackages = packagesByName.get(parsed.name);
    if (depPackages) {
      const depPkg = findMatchingPackage(depPackages, parsed.version, parsed.source);

      if (depPkg) {
        const depPurl = createCargoPurl(depPkg.name, depPkg.version);
        scopePackages.add(depPurl);
      }
    }
  }

  if (scopePackages.size === 0) {
    return [];
  }

  return [
    {
      scope: 'dependencies',
      packages: [...scopePackages],
    },
  ];
}
