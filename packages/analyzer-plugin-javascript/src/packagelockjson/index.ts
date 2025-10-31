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
import { dirname, join, resolve } from 'node:path';
import { findPackageInLockfile } from './lockfile.ts';
import { runNpmLs, isWorkspacePackage, getWorkspacePath, type NpmLsOutput, type NpmLsDependency } from './npmls.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/{package-lock.json,npm-shrinkwrap.json}');

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
    const packagePurls: string[] = [];
    const subprojects: Subproject[] = [];
    const relationships: Relationship[] = [];
    // Map of purl -> Set of evidence strings (to avoid duplicates)
    const evidenceMap = new Map<string, Set<string>>();
    // Map to detect aliases: directory name -> actual package name from lockfile
    const aliasMap = new Map<string, string>();

    try {
      // Read the lockfile content for evidence tracking and alias detection
      const lockfileContent = await Bun.file(file).text();
      const lockfileData = JSON.parse(lockfileContent);

      // Build alias map from lockfile
      // Aliases have a "name" field that differs from their directory name
      if (lockfileData.packages && typeof lockfileData.packages === 'object') {
        for (const [path, pkg] of Object.entries(lockfileData.packages)) {
          if (typeof pkg === 'object' && pkg !== null && 'name' in pkg && typeof pkg.name === 'string') {
            // Extract package name from path: "node_modules/foo" -> "foo"
            const parts = path.split('/');
            const dirName = parts[parts.length - 1];
            if (dirName && dirName !== pkg.name) {
              // This is an alias: directory name differs from actual package name
              aliasMap.set(dirName, pkg.name);
            }
          }
        }
      }

      // Read package.json to get the root package info
      const packageJsonPath = join(dir, 'package.json');
      let rootPackageInfo: PackageJson | null = null;
      try {
        const packageJsonContent = await Bun.file(packageJsonPath).text();
        rootPackageInfo = JSON.parse(packageJsonContent) as PackageJson;
      } catch {
        // package.json might not exist, continue anyway
      }

      // Run npm ls to get the dependency tree from package-lock.json only
      const result: NpmLsOutput = await runNpmLs(dir);

      // Helper function to extract scopes from a package.json
      // This creates a mapping from dependency name to the version constraint from package.json
      const extractScopesFromPackageJson = (
        packageInfo: PackageJson,
        depsTree: Record<string, NpmLsDependency> | undefined,
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
                if (typeof version === 'string') {
                  let depNamespace: string | null = null;
                  let depPackageName = depName;
                  if (depName.startsWith('@')) {
                    const parts = depName.split('/');
                    if (parts.length === 2 && parts[0] && parts[1]) {
                      depNamespace = parts[0]; // Keep @ for proper PURL encoding
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

      // Extract root package as a subproject if it has name and version
      let rootPurl: string | undefined;
      if (rootPackageInfo && rootPackageInfo.name && rootPackageInfo.version) {
        const name = rootPackageInfo.name;
        const version = rootPackageInfo.version;

        // Create a proper Package URL (PURL)
        let namespace: string | null = null;
        let packageName = name;
        if (name.startsWith('@')) {
          const parts = name.split('/');
          if (parts.length === 2 && parts[0] && parts[1]) {
            namespace = parts[0]; // Keep @ for proper PURL encoding
            packageName = parts[1];
          }
        }
        const purl = new PackageURL('npm', namespace, packageName, version, null, null);
        rootPurl = purl.toString();

        // Extract scopes for the root package
        const rootScopes = extractScopesFromPackageJson(rootPackageInfo, result.dependencies);
        subprojects.push({
          purl: rootPurl,
          definitionFile: packageJsonPath,
          scopes: rootScopes,
        });
      }

      // Extract packages from the dependency tree recursively
      // parentPurl is the purl of the package that depends on these packages
      const extractPackages = async (deps: Record<string, NpmLsDependency> | undefined, parentPurl?: string) => {
        if (!deps || typeof deps !== 'object') {
          return;
        }

        // Track dependencies for this parent to create relationships
        const childPurls: string[] = [];

        for (const [name, dep] of Object.entries(deps)) {
          if (typeof dep === 'object' && dep !== null) {
            // Check for workspace packages first (they may have null version)
            if (isWorkspacePackage(dep)) {
              const relativePath = getWorkspacePath(dep);
              if (!relativePath) {
                // Still traverse dependencies even if we can't get the path
                if (dep.dependencies) {
                  await extractPackages(dep.dependencies, parentPurl);
                }
                continue;
              }

              const subprojectDir = resolve(dir, relativePath);
              const subprojectPackageJson = join(subprojectDir, 'package.json');

              // Read workspace package.json to get name and version
              let workspacePackageName: string | undefined;
              let workspacePackageVersion: string | undefined;
              let scopes: DependencyScope[] = [];

              try {
                const workspacePackageJsonContent = await Bun.file(subprojectPackageJson).text();
                const workspacePackageInfo = JSON.parse(workspacePackageJsonContent) as PackageJson;
                workspacePackageName = workspacePackageInfo.name;
                workspacePackageVersion = workspacePackageInfo.version || '0.0.0';
                scopes = extractScopesFromPackageJson(workspacePackageInfo, dep.dependencies);
              } catch {
                // If we can't read package.json, still traverse dependencies
                if (dep.dependencies) {
                  await extractPackages(dep.dependencies, parentPurl);
                }
                continue;
              }

              if (workspacePackageName && workspacePackageVersion) {
                // Create PURL for workspace package
                let namespace: string | null = null;
                let packageName = workspacePackageName;
                if (workspacePackageName.startsWith('@')) {
                  const parts = workspacePackageName.split('/');
                  if (parts.length === 2 && parts[0] && parts[1]) {
                    namespace = parts[0];
                    packageName = parts[1];
                  }
                }
                const purl = new PackageURL('npm', namespace, packageName, workspacePackageVersion, null, null);
                const purlString = purl.toString();

                subprojects.push({
                  purl: purlString,
                  definitionFile: subprojectPackageJson,
                  scopes,
                });

                // Track relationship if we have a parent
                if (parentPurl) {
                  childPurls.push(purlString);
                }

                // Recursively process workspace dependencies
                if (dep.dependencies) {
                  await extractPackages(dep.dependencies, purlString);
                }
              }
              continue;
            }

            // For non-workspace packages, version is required
            const version = dep.version;
            if (!version || typeof version !== 'string') {
              // No version and not a workspace - just traverse dependencies
              if (dep.dependencies) {
                await extractPackages(dep.dependencies, parentPurl);
              }
              continue;
            }

            // Process regular package with valid version
            // Extract the actual package name from resolved URL for aliases
            // Aliases like string-width-cjs point to the actual package's tarball
            let actualName = name;
            if (dep.resolved && typeof dep.resolved === 'string' && dep.resolved.includes('registry.npmjs.org')) {
              const match = dep.resolved.match(/registry\.npmjs\.org\/(@[^/]+\/[^/]+|[^/]+)\/-\//);
              if (match && match[1]) {
                actualName = match[1];
              }
            }

            // Create a proper Package URL (PURL)
            // For scoped packages (@scope/name), extract scope as namespace
            let namespace: string | null = null;
            let packageName = actualName;
            if (actualName.startsWith('@')) {
              const parts = actualName.split('/');
              if (parts.length === 2 && parts[0] && parts[1]) {
                namespace = parts[0]; // Keep @ for proper PURL encoding
                packageName = parts[1];
              }
            }
            const purl = new PackageURL('npm', namespace, packageName, version, null, null);
            const purlString = purl.toString();

            // This is a regular dependency package (not workspace)
            // Skip npm alias packages without resolved URLs
            // These are duplicates that npm sbom also excludes
            if (!dep.resolved && aliasMap.has(name)) {
              // Still process their dependencies
              if (dep.dependencies) {
                await extractPackages(dep.dependencies, parentPurl);
              }
              continue;
            }

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

        // Create relationship for this parent if it has children
        if (parentPurl && childPurls.length > 0) {
          relationships.push({
            from: parentPurl,
            to: childPurls,
          });
        }
      };

      // Extract packages from the result, starting from the root
      if (result.dependencies) {
        await extractPackages(result.dependencies, rootPurl);
      }
    } catch (error) {
      // If npm ls fails, skip this file
      console.error(`Failed to run npm ls in ${dir}:`, error);
    }

    // Deduplicate packagePurls before creating package objects
    const uniquePurls = [...new Set(packagePurls)];

    return {
      packages: uniquePurls.map((purl) => {
        const evidenceSet = evidenceMap.get(purl);
        return {
          purl,
          evidence: evidenceSet && evidenceSet.size > 0 ? Array.from(evidenceSet) : [],
        };
      }),
      subprojects,
      relationships,
    };
  },
});
