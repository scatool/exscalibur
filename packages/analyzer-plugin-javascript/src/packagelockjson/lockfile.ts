/**
 * package-lock.json structure
 *
 * npm supports lockfile versions 1, 2, and 3:
 * - v1 (npm 5-6): Has "dependencies" tree at root
 * - v2 (npm 7+): Added "packages" section with flat structure
 * - v3 (npm 7+): Same as v2 with different semantics
 *
 * We primarily use the "packages" section (v2+) which is a flat map of:
 * - "" -> root package
 * - "node_modules/foo" -> dependency foo
 * - "node_modules/foo/node_modules/bar" -> nested dependency bar
 * - "apps/www" or "packages/ui" -> workspace packages
 */

/**
 * Represents a dependency entry in lockfile v1's dependencies tree
 */
export interface LockfileV1Dependency {
  /** Package version */
  version: string;
  /** Resolved URL (registry or tarball) */
  resolved?: string;
  /** Integrity checksum */
  integrity?: string;
  /** Dependencies with version ranges (v1 uses "requires") */
  requires?: Record<string, string>;
  /** Nested dependencies (only present when version conflicts exist) */
  dependencies?: Record<string, LockfileV1Dependency>;
  /** Whether this is a dev dependency */
  dev?: boolean;
  /** Whether this is optional */
  optional?: boolean;
  /** Whether this package is bundled */
  bundled?: boolean;
}

/**
 * Represents a package entry in the package-lock.json packages section (v2+)
 */
export interface PackageLockPackage {
  /** Package version */
  version?: string;
  /** Resolved URL (registry or tarball) */
  resolved?: string;
  /** Integrity checksum */
  integrity?: string;
  /** Dependencies with version ranges */
  dependencies?: Record<string, string>;
  /** Dev dependencies with version ranges */
  devDependencies?: Record<string, string>;
  /** Peer dependencies with version ranges */
  peerDependencies?: Record<string, string>;
  /** Optional dependencies with version ranges */
  optionalDependencies?: Record<string, string>;
  /** Dependencies carried by this package's archive (the alternate spelling is also accepted). */
  bundleDependencies?: string[] | boolean | Record<string, unknown>;
  bundledDependencies?: string[] | boolean | Record<string, unknown>;
  /** Whether this package is carried inside another dependency's archive. */
  inBundle?: boolean;
  /** Whether this is a dev dependency */
  dev?: boolean;
  /** Whether this is optional */
  optional?: boolean;
  /** Package name (may differ from directory for aliases) */
  name?: string;
  /** Workspace packages array (for root package) */
  workspaces?: string[];
}

/**
 * The structure of package-lock.json
 */
interface PackageLock {
  /** Lockfile version (1, 2, or 3) */
  lockfileVersion: number;
  /** Root package name */
  name?: string;
  /** Root package version */
  version?: string;
  /** Flat map of package paths to package metadata (v2+) */
  packages?: Record<string, PackageLockPackage>;
  /** Nested dependency tree (v1 only) */
  dependencies?: Record<string, LockfileV1Dependency>;
  /** Whether lockfile requires packages to be installed */
  requires?: boolean;
}

/**
 * Parse a package-lock.json file
 */
export function parsePackageLock(content: string): PackageLock {
  try {
    return JSON.parse(content) as PackageLock;
  } catch (error) {
    throw new Error(
      `Failed to parse package-lock.json: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Extract package name from a node_modules path
 * Examples:
 *   "node_modules/react" -> "react"
 *   "node_modules/@babel/core" -> "@babel/core"
 *   "node_modules/foo/node_modules/bar" -> "bar"
 */
export function extractPackageName(path: string): string | null {
  // Remove trailing slash if present
  const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;

  // Split by /node_modules/ OR node_modules/ (at start) to get the last package
  // Handle both "node_modules/foo" and "node_modules/a/node_modules/b"
  const parts = cleanPath.split(/\/?node_modules\//);
  const lastPart = parts[parts.length - 1];

  if (!lastPart) {
    return null;
  }

  // Handle scoped packages (@scope/name)
  // For scoped packages, we need exactly @scope/name, nothing after
  if (lastPart.startsWith("@")) {
    const scopeParts = lastPart.split("/");
    if (scopeParts.length >= 2 && scopeParts[0] && scopeParts[1]) {
      return `${scopeParts[0]}/${scopeParts[1]}`;
    }
  }

  // For non-scoped packages, return just the package name (first segment)
  return lastPart.split("/")[0] || lastPart;
}

/**
 * Check if a path represents a workspace package (not in node_modules)
 * Examples:
 *   "apps/www" -> true
 *   "packages/ui" -> true
 *   "node_modules/react" -> false
 *   "" -> false (root package)
 */
export function isWorkspacePath(path: string): boolean {
  return path !== "" && !path.includes("node_modules");
}

/**
 * Find the line number where a package is defined in the lockfile
 *
 * @param content - The full lockfile content
 * @param packagePath - The package path (e.g., "node_modules/react" or "apps/www")
 * @param version - The package version to find
 * @returns Line number (1-indexed) where the version is defined, or undefined
 */
export function findLineNumber(
  content: string,
  packagePath: string,
  version: string,
): number | undefined {
  const lines = content.split("\n");

  // Search for the package path entry
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";

    // Look for the package path as a JSON key
    if (line.includes(`"${packagePath}"`)) {
      // Found the package, now look for the version in the next few lines
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const versionLine = lines[j] || "";
        if (versionLine.includes(`"version"`) && versionLine.includes(`"${version}"`)) {
          return j + 1; // Return 1-indexed line number
        }
      }
      // If we didn't find the version in the next 20 lines, keep looking for another match
    }
  }

  return undefined;
}

/**
 * Find the line number where a package is defined in a lockfile v1
 *
 * @param content - The full lockfile content
 * @param packageName - The package name (e.g., "react", "@babel/core")
 * @param version - The package version to find
 * @returns Line number (1-indexed) where the version is defined, or undefined
 */
export function findLineNumberV1(
  content: string,
  packageName: string,
  version: string,
): number | undefined {
  const lines = content.split("\n");

  // Search for the package name as a key
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";

    // Look for the package name as a JSON key
    if (line.includes(`"${packageName}"`) && line.includes(":")) {
      // Found the package, now look for the version in the next few lines
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const versionLine = lines[j] || "";
        if (versionLine.includes(`"version"`) && versionLine.includes(`"${version}"`)) {
          return j + 1; // Return 1-indexed line number
        }
      }
      // If we didn't find the version in the next 20 lines, keep looking for another match
    }
  }

  return undefined;
}
