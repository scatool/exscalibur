import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  addRelationship,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  aggregateSubprojectRelationships,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { parse } from 'jsonc-parser';
import { dirname, join } from 'node:path';
import type { PackageJson } from '../types.ts';
import { createNpmPurl, NPM_DEPENDENCY_SCOPES } from '../npm-utils.ts';

const glob = new Glob('**/bun.lock');

// Lockfile package entry indices
const PKG_IDENTIFIER_INDEX = 0;
const PKG_METADATA_INDEX = 2;

export const extractor: Extractor = filesExtractor({
  name: 'bunlock',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of glob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const dir = dirname(file);

    // Parse the bun.lock file (JSONC format with comments and trailing commas)
    const lockfile = parse(content);
    const lines = content.split('\n');

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    // Build a resolution map: package name → resolved version
    // This allows us to resolve version ranges to actual versions
    const resolutionMap = new Map<string, string>();
    if (lockfile.packages && typeof lockfile.packages === 'object') {
      for (const packageInfo of Object.values(lockfile.packages)) {
        if (!Array.isArray(packageInfo) || packageInfo.length === 0) continue;

        const packageIdentifier = packageInfo[PKG_IDENTIFIER_INDEX];
        if (typeof packageIdentifier !== 'string') continue;

        // Parse name@version format
        const lastAtIndex = packageIdentifier.lastIndexOf('@');
        if (lastAtIndex <= 0) continue;

        const name = packageIdentifier.substring(0, lastAtIndex);
        const version = packageIdentifier.substring(lastAtIndex + 1);

        // Store the resolved version for this package name
        resolutionMap.set(name, version);
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

    // Build a map of workspace package names to their versions
    const workspacePackages = new Map<string, string>();
    if (lockfile.workspaces && typeof lockfile.workspaces === 'object') {
      for (const [workspacePath, workspace] of Object.entries(lockfile.workspaces)) {
        if (!workspace || typeof workspace !== 'object') continue;

        const workspaceName = 'name' in workspace ? workspace.name : undefined;
        if (!workspaceName || typeof workspaceName !== 'string') continue;

        // Determine the package.json path for this workspace
        const workspaceDir = workspacePath === '' ? dir : join(dir, workspacePath);
        const workspacePackageJsonPath = join(workspaceDir, 'package.json');

        try {
          const packageJsonContent = await Bun.file(workspacePackageJsonPath).text();
          const packageInfo = JSON.parse(packageJsonContent) as PackageJson;
          if (packageInfo.version) {
            workspacePackages.set(workspaceName, packageInfo.version);
          }
        } catch {
          // Skip invalid package.json files
          continue;
        }
      }
    }

    // Process workspaces if they exist in the lockfile
    if (lockfile.workspaces && typeof lockfile.workspaces === 'object') {
      for (const [workspacePath, workspace] of Object.entries(lockfile.workspaces)) {
        if (!workspace || typeof workspace !== 'object') continue;

        // Get workspace name from the lockfile
        const workspaceName = 'name' in workspace ? workspace.name : undefined;
        if (!workspaceName || typeof workspaceName !== 'string') continue;

        // Determine the package.json path for this workspace
        const workspaceDir = workspacePath === '' ? dir : join(dir, workspacePath);
        const workspacePackageJsonPath = join(workspaceDir, 'package.json');

        // Read package.json to get version
        let packageInfo: PackageJson | null = null;
        try {
          const packageJsonContent = await Bun.file(workspacePackageJsonPath).text();
          packageInfo = JSON.parse(packageJsonContent) as PackageJson;
        } catch {
          // Skip if package.json doesn't exist or is invalid
          continue;
        }

        if (packageInfo?.version) {
          const purl = createNpmPurl(workspaceName, packageInfo.version);
          const scopes = extractScopes(workspace as Record<string, unknown>, resolutionMap, workspacePackages);

          subprojects.push({
            purl,
            definitionFile: workspacePackageJsonPath,
            scopes,
          });
        }
      }
    } else if (rootPackageInfo?.name && rootPackageInfo.version) {
      // Fallback to reading package.json directly if no workspaces in lockfile
      const purl = createNpmPurl(rootPackageInfo.name, rootPackageInfo.version);
      const scopes = extractScopes(rootPackageInfo, resolutionMap, workspacePackages);

      subprojects.push({
        purl,
        definitionFile: packageJsonPath,
        scopes,
      });
    }

    // Process packages section to extract packages and relationships
    if (lockfile.packages && typeof lockfile.packages === 'object') {
      for (const [packageKey, packageInfo] of Object.entries(lockfile.packages)) {
        if (!Array.isArray(packageInfo) || packageInfo.length === 0) continue;

        // First element is the package identifier (name@version)
        const packageIdentifier = packageInfo[PKG_IDENTIFIER_INDEX];
        if (typeof packageIdentifier !== 'string') continue;

        // Parse name@version format
        const lastAtIndex = packageIdentifier.lastIndexOf('@');
        if (lastAtIndex <= 0) continue;

        const name = packageIdentifier.substring(0, lastAtIndex);
        const version = packageIdentifier.substring(lastAtIndex + 1);
        const purl = createNpmPurl(name, version);

        // Add package to map
        ensurePackageExists(packageMap, purl);

        // Add evidence (file path and line number)
        const lineNumber = findLineNumber(lines, packageKey);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Third element contains dependency information
        const metadata = packageInfo[PKG_METADATA_INDEX];
        if (metadata && typeof metadata === 'object') {
          // Process all dependency types
          for (const depType of NPM_DEPENDENCY_SCOPES) {
            const deps = metadata[depType];
            if (deps && typeof deps === 'object') {
              for (const [depName, depVersion] of Object.entries(deps)) {
                if (typeof depVersion === 'string') {
                  const depPurl = createNpmPurl(depName, depVersion);
                  addRelationship(relationshipsMap, purl, depPurl);
                  ensurePackageExists(packageMap, depPurl);
                }
              }
            }
          }
        }
      }
    }

    // Add relationships from subprojects to their dependencies
    aggregateSubprojectRelationships(subprojects, relationshipsMap);

    // Convert maps to arrays
    const packages = convertPackageMapToArray(packageMap);
    const relationships = convertRelationshipsMapToArray(relationshipsMap);

    return {
      packages,
      subprojects,
      relationships,
      issues: [],
    };
  },
});

/**
 * Extract dependency scopes from a package info object.
 * Uses the resolution map to convert version ranges to resolved versions.
 */
function extractScopes(
  packageInfo: Record<string, unknown>,
  resolutionMap: Map<string, string>,
  workspacePackages: Map<string, string>,
): DependencyScope[] {
  const scopes: DependencyScope[] = [];

  for (const scopeName of NPM_DEPENDENCY_SCOPES) {
    const deps = packageInfo[scopeName];
    if (!deps || typeof deps !== 'object') continue;

    const scopePackages: string[] = [];
    for (const [depName, depVersionRange] of Object.entries(deps)) {
      if (typeof depVersionRange !== 'string') continue;

      // Check if this is a workspace package
      if (depVersionRange.startsWith('workspace:')) {
        const workspaceVersion = workspacePackages.get(depName);
        if (workspaceVersion) {
          const depPurl = createNpmPurl(depName, workspaceVersion);
          scopePackages.push(depPurl);
        }
        continue;
      }

      // Look up the resolved version from the lockfile
      const resolvedVersion = resolutionMap.get(depName);
      if (resolvedVersion) {
        const depPurl = createNpmPurl(depName, resolvedVersion);
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

  return scopes;
}

/**
 * Find the line number where a package key appears in the bun.lock file.
 * In bun.lock, keys are quoted: "package-name": [...]
 */
function findLineNumber(lines: string[], packageKey: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim().startsWith(`"${packageKey}":`)) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}
