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
import { runYarnLs, isWorkspacePackage, type YarnLsDependency } from './yarnls.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/yarn.lock');

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

      // Read package.json to get the root package info
      const packageJsonPath = join(dir, 'package.json');
      let rootPackageInfo: PackageJson | null = null;
      try {
        const packageJsonContent = await Bun.file(packageJsonPath).text();
        rootPackageInfo = JSON.parse(packageJsonContent) as PackageJson;
      } catch {
        // package.json might not exist, continue anyway
      }

      // Run yarn list to get the dependency tree
      const trees: YarnLsDependency[] = await runYarnLs(dir);

      // Helper function to extract scopes from package.json
      const extractScopesFromPackageJson = (
        packageInfo: PackageJson,
        depsTree: YarnLsDependency[],
      ): DependencyScope[] => {
        const scopes: DependencyScope[] = [];
        const scopeNames = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

        // Build a map from dependency name to its resolved version
        const depMap = new Map<string, string>();
        for (const dep of depsTree) {
          depMap.set(dep.name, dep.version);
        }

        for (const scopeName of scopeNames) {
          if (packageInfo[scopeName] && typeof packageInfo[scopeName] === 'object') {
            const scopePackages: string[] = [];
            for (const depName of Object.keys(packageInfo[scopeName])) {
              const resolvedVersion = depMap.get(depName);
              if (resolvedVersion) {
                let depNamespace: string | null = null;
                let depPackageName = depName;
                if (depName.startsWith('@')) {
                  const parts = depName.split('/');
                  if (parts.length === 2 && parts[0] && parts[1]) {
                    depNamespace = parts[0].substring(1);
                    depPackageName = parts[1];
                  }
                }
                const depPurl = new PackageURL('npm', depNamespace, depPackageName, resolvedVersion, null, null);
                scopePackages.push(depPurl.toString());
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

        let namespace: string | null = null;
        let packageName = name;
        if (name.startsWith('@')) {
          const parts = name.split('/');
          if (parts.length === 2 && parts[0] && parts[1]) {
            namespace = parts[0].substring(1);
            packageName = parts[1];
          }
        }
        const purl = new PackageURL('npm', namespace, packageName, version, null, null);
        rootPurl = purl.toString();

        // Extract scopes for the root package
        const rootScopes = extractScopesFromPackageJson(rootPackageInfo, trees);
        subprojects.push({
          purl: rootPurl,
          definitionFile: packageJsonPath,
          scopes: rootScopes.length > 0 ? rootScopes : undefined,
        });
      }

      // Extract packages from the dependency tree recursively
      const extractPackages = (deps: YarnLsDependency[], parentPurl?: string, skipShadows = false) => {
        const childPurls: string[] = [];

        for (const dep of deps) {
          const name = dep.name;
          const version = dep.version;

          // Skip if no name or version
          if (!name || !version) {
            continue;
          }

          // Skip "shadow" entries when requested - these are version range references in children
          if (skipShadows && 'shadow' in dep && dep.shadow === true) {
            continue;
          }

          // Create a proper Package URL (PURL)
          let namespace: string | null = null;
          let packageName = name;
          if (name.startsWith('@')) {
            const parts = name.split('/');
            if (parts.length === 2 && parts[0] && parts[1]) {
              namespace = parts[0].substring(1);
              packageName = parts[1];
            }
          }
          const purl = new PackageURL('npm', namespace, packageName, version, null, null);
          const purlString = purl.toString();

          // Skip workspace packages for now (Yarn 1 workspaces are complex)
          if (isWorkspacePackage(dep)) {
            continue;
          }

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

          // Recursively process dependencies (skip shadows in children)
          if (dep.children && dep.children.length > 0) {
            extractPackages(dep.children, purlString, true);
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

      // Extract packages from the tree
      // Note: trees contains ALL packages (including the root), not just dependencies
      // We need to extract each package in the trees array
      extractPackages(trees, undefined, false);
    } catch (error) {
      // If yarn list fails, skip this file
      console.error(`Failed to run yarn list in ${dir}:`, error);
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
