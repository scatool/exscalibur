import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  addRelationship,
  ensurePackageExists,
  initializeExtractionMaps,
  buildResult,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { dirname, join } from 'node:path';
import type { PackageJson } from '../types.ts';
import { createNpmPurl, extractNpmScopes, NPM_DEPENDENCY_SCOPES, readPackageJson } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';

// Lockfile package entry indices
const PKG_IDENTIFIER_INDEX = 0;
const PKG_METADATA_INDEX = 2;

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'bunlock',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    await scanAndMarkFiles(this, codebase, '**/bun.lock', options.ignore ?? []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const content = await Bun.file(file).text();
    const dir = dirname(file);

    // Parse the bun.lock file (JSONC format with comments and trailing commas)
    const lockfile = Bun.JSONC.parse(content) as Record<string, unknown>;
    const lines = content.split('\n');

    const packageInfoMap = new Map<string, { name: string; version: string }>();
    if (lockfile.packages && typeof lockfile.packages === 'object') {
      for (const [packageKey, packageInfo] of Object.entries(lockfile.packages)) {
        if (!Array.isArray(packageInfo) || packageInfo.length === 0) continue;

        const packageIdentifier = packageInfo[PKG_IDENTIFIER_INDEX];
        if (typeof packageIdentifier !== 'string') continue;

        // Parse name@version format
        const lastAtIndex = packageIdentifier.lastIndexOf('@');
        if (lastAtIndex <= 0) continue;

        const name = packageIdentifier.substring(0, lastAtIndex);
        const version = packageIdentifier.substring(lastAtIndex + 1);

        packageInfoMap.set(packageKey, { name, version });
      }
    }

    // Read package.json to get the root package info
    const packageJsonPath = join(dir, 'package.json');
    const rootPackageInfo = await readPackageJson(packageJsonPath);

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

        const packageInfo = await readPackageJson(workspacePackageJsonPath);
        if (packageInfo?.version) {
          workspacePackages.set(workspaceName, packageInfo.version);
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

        const packageInfo = await readPackageJson(workspacePackageJsonPath);
        if (!packageInfo) continue;

        if (packageInfo.version) {
          const purl = createNpmPurl(workspaceName, packageInfo.version);
          const scopes = extractScopes(
            workspace as Record<string, unknown>,
            packageInfoMap,
            workspacePackages,
            workspaceName,
          );

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
      const scopes = extractScopes(rootPackageInfo, packageInfoMap, workspacePackages, '');

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
              for (const [depName, depVersionRange] of Object.entries(deps)) {
                if (typeof depVersionRange !== 'string') continue;

                // Check if this is a workspace package
                if (depVersionRange.startsWith('workspace:')) {
                  const workspaceVersion = workspacePackages.get(depName);
                  if (workspaceVersion) {
                    const depPurl = createNpmPurl(depName, workspaceVersion);
                    addRelationship(relationshipsMap, purl, depPurl);
                    ensurePackageExists(packageMap, depPurl);
                  }
                  continue;
                }

                // Resolve the dependency using bun's key hierarchy
                const resolved = resolvePackageInfo(depName, packageInfoMap, packageKey);
                if (resolved) {
                  const depPurl = createNpmPurl(resolved.name, resolved.version);
                  addRelationship(relationshipsMap, purl, depPurl);
                  ensurePackageExists(packageMap, depPurl);
                }
              }
            }
          }
        }
      }
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

function extractScopes(
  packageInfo: Record<string, unknown>,
  packageInfoMap: Map<string, { name: string; version: string }>,
  workspacePackages: Map<string, string>,
  callerKey: string,
): DependencyScope[] {
  return extractNpmScopes(packageInfo, (depName, versionRange) => {
    if (versionRange.startsWith('workspace:')) {
      const workspaceVersion = workspacePackages.get(depName);
      return workspaceVersion ? createNpmPurl(depName, workspaceVersion) : null;
    }
    const resolved = resolvePackageInfo(depName, packageInfoMap, callerKey);
    return resolved ? createNpmPurl(resolved.name, resolved.version) : null;
  });
}

/**
 * Resolve a dependency's package info using bun's key hierarchy.
 * Bun uses slash-separated keys for nested versions:
 *   "express/debug" means debug nested under express.
 *
 * For callerKey "express" and depName "ms":
 *   1. Check "express/ms"
 *   2. Check "ms" (top-level)
 *
 * For callerKey "express/debug" and depName "ms":
 *   1. Check "express/debug/ms"
 *   2. Check "express/ms"
 *   3. Check "ms" (top-level)
 */
function resolvePackageInfo(
  depName: string,
  packageInfoMap: Map<string, { name: string; version: string }>,
  callerKey: string,
): { name: string; version: string } | null {
  if (callerKey === '') {
    return packageInfoMap.get(depName) ?? null;
  }

  // Check nested under caller first
  const nested = packageInfoMap.get(`${callerKey}/${depName}`);
  if (nested) return nested;

  // Walk up by stripping the last slash segment
  const lastSlash = callerKey.lastIndexOf('/');
  if (lastSlash !== -1) {
    return resolvePackageInfo(depName, packageInfoMap, callerKey.substring(0, lastSlash));
  }

  // Fall back to top-level
  return packageInfoMap.get(depName) ?? null;
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
