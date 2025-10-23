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
import { findPackageInLockfile } from './lockfile.ts';
import { runPnpmLs, isWorkspacePackage, type PnpmLsOutput, type PnpmLsDependency } from './pnpmls.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/pnpm-lock.yaml');

export const extractor: Extractor = filesExtractor({
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
    const packagePurls: string[] = [];
    const subprojects: Subproject[] = [];
    const relationships: Relationship[] = [];
    // Map of purl -> Set of evidence strings (to avoid duplicates)
    const evidenceMap = new Map<string, Set<string>>();

    try {
      // Read the lockfile content for evidence tracking
      const lockfileContent = await Bun.file(file).text();

      // Run pnpm install + pnpm ls -r to get the dependency tree
      // This returns an array: one element per workspace package (or single element for non-workspaces)
      const results: PnpmLsOutput[] = await runPnpmLs(dir);

      // Helper function to extract scopes from a package.json
      // This creates a mapping from dependency name to the version constraint from package.json
      const extractScopesFromPackageJson = (
        packageInfo: PackageJson,
        depsTree: Record<string, PnpmLsDependency> | undefined,
      ): DependencyScope[] => {
        const scopes: DependencyScope[] = [];
        const scopeNames = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

        for (const scopeName of scopeNames) {
          if (packageInfo[scopeName] && typeof packageInfo[scopeName] === 'object') {
            const scopePackages: string[] = [];
            for (const depName of Object.keys(packageInfo[scopeName])) {
              // Look up the resolved version from the dependency tree
              const depInfo = depsTree?.[depName];
              if (depInfo && typeof depInfo === 'object' && 'version' in depInfo) {
                const version = depInfo.version;
                // Skip workspace links (they'll be added as subprojects)
                if (typeof version === 'string' && !version.startsWith('link:')) {
                  let depNamespace: string | null = null;
                  let depPackageName = depName;
                  if (depName.startsWith('@')) {
                    const parts = depName.split('/');
                    if (parts.length === 2 && parts[0] && parts[1]) {
                      depNamespace = parts[0].substring(1);
                      depPackageName = parts[1];
                    }
                  }
                  const depPurl = new PackageURL('npm', depNamespace, depPackageName, version, null, null);
                  const purlString = depPurl.toString();
                  scopePackages.push(purlString);
                }
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

      // Process each workspace package (or the single root package)

      for (const result of results) {
        // Get the package info for this workspace member
        const workspacePath = result.path || dir;
        const workspacePackageJsonPath = join(workspacePath, 'package.json');

        let packageInfo: PackageJson | null = null;
        try {
          const packageJsonContent = await Bun.file(workspacePackageJsonPath).text();
          packageInfo = JSON.parse(packageJsonContent) as PackageJson;
        } catch {
          // If we can't read package.json, skip this workspace member
          continue;
        }

        if (packageInfo && packageInfo.name && packageInfo.version) {
          const name = packageInfo.name;
          const version = packageInfo.version;

          // Create a proper Package URL (PURL)
          let namespace: string | null = null;
          let packageName = name;
          if (name.startsWith('@')) {
            const parts = name.split('/');
            if (parts.length === 2 && parts[0] && parts[1]) {
              namespace = parts[0].substring(1); // Remove @ prefix
              packageName = parts[1];
            }
          }
          const purl = new PackageURL('npm', namespace, packageName, version, null, null);
          const purlString = purl.toString();

          // Combine all dependency types for extracting scopes
          const allDeps: Record<string, PnpmLsDependency> = {};
          if (result.dependencies) {
            Object.assign(allDeps, result.dependencies);
          }
          if (result.devDependencies) {
            Object.assign(allDeps, result.devDependencies);
          }
          if (result.optionalDependencies) {
            Object.assign(allDeps, result.optionalDependencies);
          }

          // Extract scopes for this package
          const packageScopes = extractScopesFromPackageJson(packageInfo, allDeps);
          subprojects.push({
            purl: purlString,
            definitionFile: workspacePackageJsonPath,
            scopes: packageScopes.length > 0 ? packageScopes : undefined,
          });
        }
      }

      // Extract packages from the dependency tree recursively
      // parentPurl is the purl of the package that depends on these packages
      const extractPackages = async (deps: Record<string, PnpmLsDependency> | undefined, parentPurl?: string) => {
        if (!deps || typeof deps !== 'object') {
          return;
        }

        // Track dependencies for this parent to create relationships
        const childPurls: string[] = [];

        for (const [name, dep] of Object.entries(deps)) {
          if (typeof dep === 'object' && dep !== null && 'version' in dep) {
            const version = dep.version;
            if (typeof version === 'string') {
              // Create a proper Package URL (PURL)
              // For scoped packages (@scope/name), extract scope as namespace
              let namespace: string | null = null;
              let packageName = name;
              if (name.startsWith('@')) {
                const parts = name.split('/');
                if (parts.length === 2 && parts[0] && parts[1]) {
                  namespace = parts[0].substring(1); // Remove @ prefix
                  packageName = parts[1];
                }
              }
              const purl = new PackageURL('npm', namespace, packageName, version, null, null);
              const purlString = purl.toString();

              if (isWorkspacePackage(dep)) {
                // This is a workspace package (internal workspace link)
                // Since we're using pnpm ls -r, all workspace packages are already processed
                // from the results array, so we just need to track the relationship here
                if (parentPurl) {
                  // Find the actual version for this workspace package from subprojects
                  const workspaceSubproject = subprojects.find((sp) => {
                    // Match by name (extract from purl)
                    const spName = sp.purl.split('@').slice(0, -1).join('@').replace('pkg:npm/', '');
                    return spName === name;
                  });

                  if (workspaceSubproject) {
                    childPurls.push(workspaceSubproject.purl);
                  }
                }
                // Don't recursively process - already handled by results iteration
                continue;
              } else {
                // This is a regular dependency package
                packagePurls.push(purlString);

                // Add evidence from lockfile
                const lineNumber = findPackageInLockfile(lockfileContent, name, version);
                if (lineNumber) {
                  const evidence = `${file}#${lineNumber}`;
                  const existing = evidenceMap.get(purlString);
                  if (existing) {
                    existing.add(evidence);
                  } else {
                    evidenceMap.set(purlString, new Set([evidence]));
                  }
                }

                // Track relationship if we have a parent
                if (parentPurl) {
                  childPurls.push(purlString);
                }

                // Recursively process dependencies
                if (dep.dependencies) {
                  await extractPackages(dep.dependencies, purlString);
                }
              }
            }
          }
        }

        // Create relationship for this parent if it has children
        if (parentPurl && childPurls.length > 0) {
          relationships.push({
            from: parentPurl,
            to: childPurls,
          });
        }
      };

      // Extract packages from all workspace packages
      for (const result of results) {
        // Determine the parent purl for this workspace package
        const workspacePath = result.path || dir;
        let parentPurl: string | undefined;

        // Find the matching subproject for this workspace package
        const matchingSubproject = subprojects.find((sp) => sp.definitionFile === join(workspacePath, 'package.json'));
        if (matchingSubproject) {
          parentPurl = matchingSubproject.purl;
        }

        // Extract packages from all dependency types
        if (result.dependencies) {
          await extractPackages(result.dependencies, parentPurl);
        }
        if (result.devDependencies) {
          await extractPackages(result.devDependencies, parentPurl);
        }
        if (result.optionalDependencies) {
          await extractPackages(result.optionalDependencies, parentPurl);
        }
      }
    } catch (error) {
      // If pnpm ls fails, skip this file
      console.error(`Failed to run pnpm ls in ${dir}:`, error);
    }

    // Deduplicate packagePurls before creating package objects
    const uniquePurls = [...new Set(packagePurls)];

    const result: AnalyzerResult = {
      packages: uniquePurls.map((purl) => {
        const pkg: { purl: string; evidence?: string[] } = { purl };
        const evidenceSet = evidenceMap.get(purl);
        if (evidenceSet && evidenceSet.size > 0) {
          pkg.evidence = Array.from(evidenceSet);
        }
        return pkg;
      }),
    };

    if (subprojects.length > 0) {
      result.subprojects = subprojects;
    }

    if (relationships.length > 0) {
      result.relationships = relationships;
    }

    return result;
  },
});
