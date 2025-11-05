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
  isWorkspacePackage,
  parseCargoLockfile,
  parseCargoToml,
  parseDependency,
  type CargoLockPackage,
} from './lockfile.ts';

const lockfileGlob = new Glob('**/Cargo.lock');

export const extractor: Extractor = filesExtractor({
  name: 'cargolock',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true })) {
      // Skip files in target directory (build output)
      if (!file.includes('/target/')) {
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
              const purl = createPurl(memberCargoToml.package.name, memberCargoToml.package.version);

              // Find this package in the lockfile to get its dependencies
              const pkg = (lockfile.package || []).find(
                (p) => p.name === memberCargoToml.package!.name && p.version === memberCargoToml.package!.version,
              );

              const scopes = extractScopes(pkg, packagesByName, workspacePackages);

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
        const purl = createPurl(rootPackageName, rootPackageVersion);

        // Find this package in the lockfile to get its dependencies
        const pkg = (lockfile.package || []).find(
          (p) => p.name === rootPackageName && p.version === rootPackageVersion,
        );

        const scopes = extractScopes(pkg, packagesByName, workspacePackages);

        subprojects.push({
          purl,
          definitionFile: cargoTomlPath,
          scopes,
        });
      }

      // Process all packages in the lockfile
      for (const pkg of lockfile.package || []) {
        const purl = createPurl(pkg.name, pkg.version);

        // Add package to map
        if (!packageMap.has(purl)) {
          packageMap.set(purl, { purl, evidence: new Set() });
        }

        // Add evidence (file path and line number)
        const lineNumber = findLineNumber(lockfileContent, pkg.name);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Process dependencies
        if (pkg.dependencies) {
          for (const dep of pkg.dependencies) {
            const parsed = parseDependency(dep);

            // Find the matching package in the lockfile
            const depPackages = packagesByName.get(parsed.name);
            if (depPackages) {
              // If version is specified, find exact match; otherwise use the first/only version
              let depPkg: CargoLockPackage | undefined;
              if (parsed.version) {
                depPkg = depPackages.find((p) => p.version === parsed.version);
              } else {
                depPkg = depPackages[0];
              }

              if (depPkg) {
                const depPurl = createPurl(depPkg.name, depPkg.version);
                addRelationship(relationshipsMap, purl, depPurl);
                ensurePackageExists(packageMap, depPurl);
              }
            }
          }
        }
      }

      // Add relationships from subprojects to their dependencies
      for (const subproject of subprojects) {
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
 * Extract dependency scopes from a package
 * Cargo doesn't distinguish between dependency types in the lockfile,
 * so we use a single "dependencies" scope
 */
function extractScopes(
  pkg: CargoLockPackage | undefined,
  packagesByName: Map<string, CargoLockPackage[]>,
  workspacePackages: Map<string, string>,
): DependencyScope[] {
  if (!pkg || !pkg.dependencies || pkg.dependencies.length === 0) {
    return [];
  }

  const scopePackages: string[] = [];

  for (const dep of pkg.dependencies) {
    const parsed = parseDependency(dep);

    // Find the matching package in the lockfile
    const depPackages = packagesByName.get(parsed.name);
    if (depPackages) {
      // If version is specified, find exact match; otherwise use the first/only version
      let depPkg: CargoLockPackage | undefined;
      if (parsed.version) {
        depPkg = depPackages.find((p) => p.version === parsed.version);
      } else {
        depPkg = depPackages[0];
      }

      if (depPkg) {
        const depPurl = createPurl(depPkg.name, depPkg.version);
        scopePackages.push(depPurl);
      }
    }
  }

  if (scopePackages.length === 0) {
    return [];
  }

  return [
    {
      scope: 'dependencies',
      packages: scopePackages,
    },
  ];
}

/**
 * Create a PURL for a Cargo package
 */
function createPurl(name: string, version: string): string {
  return new PackageURL('cargo', null, name, version, null, null).toString();
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
