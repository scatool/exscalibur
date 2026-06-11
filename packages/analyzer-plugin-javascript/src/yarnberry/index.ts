import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
  readNormalizedTextFile,
  readTextFile,
  scanFiles,
} from "@scatool/analyzer-core";
import { dirname, join } from "node:path/posix";
import {
  findLineNumber,
  parsePackagePattern,
  parseYarnBerryLockfile,
  resolvePackageVersion,
  type YarnBerryLockfile,
} from "./lockfile.ts";
import {
  createNpmPurl,
  extractNpmScopes,
  NPM_DEPENDENCY_SCOPES,
  readPackageJson,
} from "../npm-utils.ts";
import type { JavaScriptOptions } from "../options.ts";
import { optionSchema } from "../options.ts";

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: "yarnberry",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    for (const file of await scanFiles(codebase, "**/yarn.lock", options.ignore)) {
      // Only mark Yarn Berry lockfiles (version 8+)
      // Check the first few lines for __metadata: section
      try {
        const buffer = (await readTextFile(file)).slice(0, 500);

        // Check for Yarn Berry markers
        // Yarn Berry uses lockfile version 6+ (v2, v3, v4 all use different formats)
        // We support v6 (Yarn v3/v4) and v8+ (Yarn v4+)
        if (buffer.includes("__metadata:") && /version:\s+[6-9]\d*/.test(buffer)) {
          this.markFile(file);
        }
      } catch {
        // Skip files we can't read
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const lockfileContent = await readNormalizedTextFile(file);
    const lockfile = parseYarnBerryLockfile(lockfileContent);

    // Find all workspace packages by looking for linkType: soft
    const workspacePackages = new Map<string, { version: string; path: string }>();
    const workspacePatterns = new Map<string, string>(); // Map package name to workspace path

    for (const [pattern, pkg] of lockfile.packages.entries()) {
      // Check if this is a workspace package (linkType: soft)
      if (pkg.linkType === "soft") {
        const parsed = parsePackagePattern(pattern);
        if (parsed && parsed.type === "workspace") {
          // This is the workspace: pattern - store the path
          workspacePatterns.set(parsed.name, parsed.versionOrPath);
        }
      }
    }

    // Now read package.json files for all workspace packages
    for (const [name, path] of workspacePatterns.entries()) {
      const workspaceDir = path === "." ? dir : join(dir, path);
      const packageJsonPath = join(workspaceDir, "package.json");
      const packageInfo = await readPackageJson(packageJsonPath);
      if (packageInfo?.version) {
        workspacePackages.set(name, {
          version: packageInfo.version,
          path,
        });
      }
    }

    // Process workspace packages to create subprojects
    for (const [name, info] of workspacePackages.entries()) {
      // Find the workspace package entry in the lockfile
      const workspacePattern = `${name}@workspace:${info.path}`;
      const pkg = lockfile.packages.get(workspacePattern);
      if (!pkg) continue;

      const workspaceDir = info.path === "." ? dir : join(dir, info.path);
      const packageJsonPath = join(workspaceDir, "package.json");

      // Create PURL for this subproject
      const purl = createNpmPurl(name, info.version);

      // Extract scopes - read from package.json to preserve original dependency types
      // (Yarn Berry lockfile normalizes all deps to just "dependencies")
      const scopes: DependencyScope[] = [];

      // Read package.json to get the original dependency scopes
      const packageInfo = await readPackageJson(packageJsonPath);
      if (!packageInfo) continue;

      const extractedScopes = extractNpmScopes(
        packageInfo as Record<string, unknown>,
        (depName, versionRange) => {
          const workspaceVersion = workspacePackages.get(depName);
          if (workspaceVersion) return createNpmPurl(depName, workspaceVersion.version);
          const { actualName, actualRange } = parseAliasedDependency(depName, versionRange);
          const resolvedVersion = resolvePackageVersion(lockfile, actualName, actualRange);
          return resolvedVersion ? createNpmPurl(actualName, resolvedVersion) : null;
        },
      );
      scopes.push(...extractedScopes);

      subprojects.push({
        purl,
        definitionFile: packageJsonPath,
        scopes,
      });
    }

    // If no workspace packages found, check if this is a single-package project
    if (subprojects.length === 0) {
      const packageJsonPath = join(dir, "package.json");
      const packageInfo = await readPackageJson(packageJsonPath);

      if (packageInfo?.name && packageInfo.version) {
        const purl = createNpmPurl(packageInfo.name, packageInfo.version);

        const scopes = extractNpmScopes(
          packageInfo as Record<string, unknown>,
          (depName, versionRange) => {
            const { actualName, actualRange } = parseAliasedDependency(depName, versionRange);
            const resolvedVersion = resolvePackageVersion(lockfile, actualName, actualRange);
            return resolvedVersion ? createNpmPurl(actualName, resolvedVersion) : null;
          },
        );

        subprojects.push({
          purl,
          definitionFile: packageJsonPath,
          scopes,
        });
      }
    }

    // Process all packages to extract packages and relationships
    for (const [pattern, pkg] of lockfile.packages.entries()) {
      const parsed = parsePackagePattern(pattern);
      if (!parsed) continue;

      // Skip packages that shouldn't be included in the graph
      // - workspace packages (they're subprojects, not external dependencies)
      // - patch/link/portal protocols (internal Yarn protocols)
      // - workspace version marker (0.0.0-use.local)
      if (
        parsed.type === "workspace" ||
        parsed.type === "patch" ||
        parsed.type === "link" ||
        parsed.type === "portal" ||
        pkg.version === "0.0.0-use.local"
      ) {
        continue;
      }

      // For npm aliases, use the real package name, not the alias
      const { name } = parsed;
      const version = pkg.version;

      // Skip if no version
      if (!version) continue;

      const purl = createNpmPurl(name, version);

      // Add package with evidence
      ensurePackageExists(packageMap, purl);

      // Use the original combined pattern for evidence tracking
      // (handles cases where multiple patterns are comma-separated in the lockfile)
      const patternToFind = pkg.originalPattern || pattern;
      const lineNumber = findLineNumber(lockfileContent, patternToFind);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Extract relationships from dependencies
      processDependencies(pkg, purl, lockfile, packageMap, relationshipsMap);
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

/**
 * Parse an aliased dependency from package.json
 *
 * Examples:
 * - parseAliasedDependency("react-old", "npm:react@^16.0.0") => { actualName: "react", actualRange: "^16.0.0" }
 * - parseAliasedDependency("lodash", "^4.17.21") => { actualName: "lodash", actualRange: "^4.17.21" }
 */
function parseAliasedDependency(
  depName: string,
  versionRange: string,
): { actualName: string; actualRange: string } {
  // Check for npm alias format: "npm:packageName@version"
  const aliasMatch = versionRange.match(/^npm:(.+?)@(.+)$/);
  if (aliasMatch && aliasMatch[1] && aliasMatch[2]) {
    return {
      actualName: aliasMatch[1],
      actualRange: aliasMatch[2],
    };
  }

  // Not an alias - return as-is
  return {
    actualName: depName,
    actualRange: versionRange,
  };
}

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
  for (const depType of NPM_DEPENDENCY_SCOPES) {
    const depsInScope = deps[depType];
    if (depsInScope && typeof depsInScope === "object") {
      for (const [depName, depRef] of Object.entries(depsInScope)) {
        if (typeof depRef === "string") {
          // Extract the version range from npm: prefix
          let versionRange = depRef;
          if (versionRange.startsWith("npm:")) {
            versionRange = versionRange.substring(4);
          }

          // Resolve to the actual installed version
          const resolvedVersion = resolvePackageVersion(lockfile, depName, versionRange);
          if (resolvedVersion) {
            const depPurl = createNpmPurl(depName, resolvedVersion);

            addRelationship(relationshipsMap, purl, depPurl);
            ensurePackageExists(packageMap, depPurl);
          }
        }
      }
    }
  }
}
