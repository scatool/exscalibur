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
 * Represents a package entry in the package-lock.json packages section
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
  /** Whether this package is bundled */
  bundled?: boolean;
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
export interface PackageLock {
  /** Lockfile version (1, 2, or 3) */
  lockfileVersion: number;
  /** Root package name */
  name?: string;
  /** Root package version */
  version?: string;
  /** Flat map of package paths to package metadata (v2+) */
  packages?: Record<string, PackageLockPackage>;
  /** Whether lockfile requires packages to be installed */
  requires?: boolean;
}

/**
 * Parse a package-lock.json file
 */
export function parsePackageLock(content: string): PackageLock {
  return JSON.parse(content) as PackageLock;
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
  const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;

  // Split by node_modules to get the last package
  const parts = cleanPath.split('/node_modules/');
  const lastPart = parts[parts.length - 1];

  if (!lastPart) {
    return null;
  }

  // Handle scoped packages (@scope/name)
  if (lastPart.startsWith('@')) {
    const scopeParts = lastPart.split('/');
    if (scopeParts.length >= 2 && scopeParts[0] && scopeParts[1]) {
      return `${scopeParts[0]}/${scopeParts[1]}`;
    }
  }

  return lastPart;
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
  return path !== '' && !path.includes('node_modules');
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
  const lines = content.split('\n');

  // Search for the package path entry
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';

    // Look for the package path as a JSON key
    if (line.includes(`"${packagePath}"`)) {
      // Found the package, now look for the version in the next few lines
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        const versionLine = lines[j] || '';
        if (versionLine.includes(`"version"`) && versionLine.includes(`"${version}"`)) {
          return j + 1; // Return 1-indexed line number
        }
      }
      // If we didn't find the version in the next 20 lines, keep looking for another match
    }
  }

  return undefined;
}
