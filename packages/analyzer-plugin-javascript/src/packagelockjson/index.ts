import {type AnalyzerResult, type DependencyScope, type Extractor, type Relationship, type Subproject, filesExtractor} from '@scatool/analyzer-core/src/index.ts';
import {Glob} from 'bun';
import {PackageURL} from 'packageurl-js';
import {dirname, join, resolve} from 'node:path';
import {findPackageInLockfile} from './lockfile.ts';
import {runNpmLs, isWorkspacePackage, getWorkspacePath, type NpmLsOutput, type NpmLsDependency} from './npmls.ts';

const lockfileGlob = new Glob('**/{package-lock.json,npm-shrinkwrap.json}');

export const extractor: Extractor = filesExtractor({
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({cwd: codebase, absolute: true})) {
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

      // Read package.json to get the root package info
      const packageJsonPath = join(dir, 'package.json');
      let rootPackageInfo: Record<string, unknown> | null = null;
      try {
        const packageJsonContent = await Bun.file(packageJsonPath).text();
        rootPackageInfo = JSON.parse(packageJsonContent);
      } catch {
        // package.json might not exist, continue anyway
      }

      // Run npm ls to get the dependency tree from package-lock.json only
      const result: NpmLsOutput = await runNpmLs(dir);

      // Helper function to extract scopes from a package.json
      // This creates a mapping from dependency name to the version constraint from package.json
      const extractScopesFromPackageJson = (packageInfo: Record<string, unknown>, depsTree: Record<string, NpmLsDependency> | undefined): DependencyScope[] => {
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
            namespace = parts[0].substring(1); // Remove @ prefix
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
          scopes: rootScopes.length > 0 ? rootScopes : undefined,
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
                // This is a workspace package - add it as a subproject
                const relativePath = getWorkspacePath(dep);
                if (!relativePath) {
                  continue;
                }

                const subprojectDir = resolve(dir, relativePath);
                const subprojectPackageJson = join(subprojectDir, 'package.json');

                // Read the workspace package's package.json to get its scopes
                let scopes: DependencyScope[] = [];
                try {
                  const workspacePackageJsonContent = await Bun.file(subprojectPackageJson).text();
                  const workspacePackageInfo = JSON.parse(workspacePackageJsonContent) as Record<string, unknown>;
                  // Pass the dependencies from this workspace package's tree
                  scopes = extractScopesFromPackageJson(workspacePackageInfo, dep.dependencies);
                } catch {
                  // If we can't read the workspace package.json, continue without scopes
                }

                subprojects.push({
                  purl: purlString,
                  definitionFile: subprojectPackageJson,
                  scopes: scopes.length > 0 ? scopes : undefined,
                });

                // Track relationship if we have a parent
                if (parentPurl) {
                  childPurls.push(purlString);
                }

                // Recursively process this workspace's dependencies
                if (dep.dependencies) {
                  await extractPackages(dep.dependencies, purlString);
                }
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

    const result: AnalyzerResult = {
      packages: uniquePurls.map(purl => {
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
