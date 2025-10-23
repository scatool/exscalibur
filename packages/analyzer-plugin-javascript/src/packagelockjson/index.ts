import {type AnalyzerResult, type DependencyScope, type Extractor, type Subproject, filesExtractor} from '@scatool/analyzer-core/src/index.ts';
import {Glob} from 'bun';
import {PackageURL} from 'packageurl-js';
import {dirname, join, resolve} from 'node:path';

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

    try {
      // Read package.json to get the root package info
      const packageJsonPath = join(dir, 'package.json');
      let rootPackageInfo: any = null;
      try {
        const packageJsonContent = await Bun.file(packageJsonPath).text();
        rootPackageInfo = JSON.parse(packageJsonContent);
      } catch {
        // package.json might not exist, continue anyway
      }

      // Run npm ls to get the dependency tree from package-lock.json only
      const proc = Bun.spawn(['npm', 'ls', '--json', '--all', '--package-lock-only'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      // Parse the npm ls output
      const result = JSON.parse(output);

      // Helper function to extract scopes from a package.json
      // This creates a mapping from dependency name to the version constraint from package.json
      const extractScopesFromPackageJson = (packageInfo: any, depsTree: any): DependencyScope[] => {
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
                  scopePackages.push(depPurl.toString());
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

        // Extract scopes for the root package
        const rootScopes = extractScopesFromPackageJson(rootPackageInfo, result.dependencies);
        subprojects.push({
          purl: purl.toString(),
          definitionFile: packageJsonPath,
          scopes: rootScopes.length > 0 ? rootScopes : undefined,
        });
      }

      // Extract packages from the dependency tree recursively
      const extractPackages = async (deps: any) => {
        if (!deps || typeof deps !== 'object') {
          return;
        }

        for (const [name, info] of Object.entries(deps)) {
          if (typeof info === 'object' && info !== null && 'version' in info) {
            const version = (info as any).version;
            if (typeof version === 'string') {
              // Check if this is a workspace/local package (resolved to file:...)
              const resolved = (info as any).resolved;
              const isWorkspacePackage = typeof resolved === 'string' && resolved.startsWith('file:');

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

              if (isWorkspacePackage) {
                // This is a workspace package - add it as a subproject
                // npm ls gives paths relative to node_modules, but we need the actual location
                // The package-lock.json has the correct path, but we get it from npm ls here
                // So we need to try resolving it correctly
                let relativePath = resolved.replace('file:', '');

                // npm ls sometimes returns paths like "../../apps/docs" which are relative to node_modules
                // We want paths relative to the lockfile directory
                // If the path starts with ../, it's likely relative to node_modules, so adjust it
                if (relativePath.startsWith('../')) {
                  // Remove the ../../ prefix and just use the last parts
                  const parts = relativePath.split('/').filter(p => p !== '..' && p !== '.');
                  relativePath = parts.join('/');
                }

                const subprojectDir = resolve(dir, relativePath);
                const subprojectPackageJson = join(subprojectDir, 'package.json');

                // Read the workspace package's package.json to get its scopes
                let scopes: DependencyScope[] = [];
                try {
                  const workspacePackageJsonContent = await Bun.file(subprojectPackageJson).text();
                  const workspacePackageInfo = JSON.parse(workspacePackageJsonContent);
                  // Pass the dependencies from this workspace package's tree
                  const workspaceDeps = (info as any).dependencies;
                  scopes = extractScopesFromPackageJson(workspacePackageInfo, workspaceDeps);
                } catch {
                  // If we can't read the workspace package.json, continue without scopes
                }

                subprojects.push({
                  purl: purl.toString(),
                  definitionFile: subprojectPackageJson,
                  scopes: scopes.length > 0 ? scopes : undefined,
                });
              } else {
                // This is a regular dependency package
                packagePurls.push(purl.toString());
              }
            }

            // Recursively process dependencies
            if ('dependencies' in info) {
              await extractPackages((info as any).dependencies);
            }
          }
        }
      };

      // Extract packages from the result
      if (result.dependencies) {
        await extractPackages(result.dependencies);
      }
    } catch (error) {
      // If npm ls fails, skip this file
      console.error(`Failed to run npm ls in ${dir}:`, error);
    }

    return {
      packages: packagePurls.map(purl => ({ purl })),
      subprojects: subprojects.length > 0 ? subprojects : undefined,
    };
  },
});
