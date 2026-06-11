import { parse as parseYaml } from "yaml";

/**
 * Base lockfile structure shared by all versions
 */
interface PnpmLockfileBase {
  lockfileVersion: string | number;
  importers?: Record<string, PnpmImporter>;
}

/**
 * Lockfile v6 and earlier format
 * - packages section contains both metadata AND dependency relationships
 * - package keys may include peer dependency suffixes
 */
export interface PnpmLockfileV6 extends PnpmLockfileBase {
  packages?: Record<string, PnpmPackageEntry>;
}

/**
 * Lockfile v9+ format
 * - packages section contains only metadata (resolution, integrity, etc.)
 * - snapshots section contains dependency relationships
 * - snapshot keys include peer dependency suffixes
 */
export interface PnpmLockfileV9 extends PnpmLockfileBase {
  packages?: Record<string, PnpmPackageMetadata>;
  snapshots?: Record<string, PnpmSnapshotEntry>;
}

/**
 * Union type for all lockfile versions
 */
export type PnpmLockfile = PnpmLockfileV6 | PnpmLockfileV9;

interface PnpmImporter {
  dependencies?: Record<string, PnpmDependencyRef>;
  devDependencies?: Record<string, PnpmDependencyRef>;
  optionalDependencies?: Record<string, PnpmDependencyRef>;
  peerDependencies?: Record<string, PnpmDependencyRef>;
}

interface PnpmDependencyRef {
  specifier: string;
  version: string;
}

/**
 * Package metadata (used in v9+ packages section, and v6 packages with relationships)
 */
export interface PnpmPackageMetadata {
  version?: string;
  resolution?: {
    integrity?: string;
    tarball?: string;
    commit?: string;
    repo?: string;
    type?: string;
  };
  engines?: Record<string, string>;
  cpu?: string[];
  os?: string[];
}

/**
 * Package entry with relationships (used in v6 and earlier packages section)
 */
export interface PnpmPackageEntry extends PnpmPackageMetadata {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface PnpmSnapshotEntry {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  transitivePeerDependencies?: string[];
  optional?: boolean;
}

export function parsePnpmLockfile(content: string): PnpmLockfile {
  return parseYaml(content) as PnpmLockfile;
}

/**
 * Extract package name and version from a pnpm package key
 * Examples:
 *   "@babel/core@7.23.9" -> { name: "@babel/core", version: "7.23.9" }
 *   "lodash@4.17.21" -> { name: "lodash", version: "4.17.21" }
 *   "@babel/core@7.23.9(@babel/preset-env@7.23.9)" -> { name: "@babel/core", version: "7.23.9" }
 */
export function parsePackageKey(key: string): { name: string; version: string } | null {
  // Remove peer dependency suffix if present: name@version(peer-deps) -> name@version
  const parenIndex = key.indexOf("(");
  const searchString = parenIndex > 0 ? key.substring(0, parenIndex) : key;

  // Find the last @ (version separator)
  // For scoped packages (@babel/core@7.23.9), this skips the scope @
  // For regular packages (lodash@4.17.21), this finds the only @
  const lastAtIndex = searchString.lastIndexOf("@");
  if (lastAtIndex > 0) {
    const name = searchString.substring(0, lastAtIndex);
    const version = searchString.substring(lastAtIndex + 1);
    return { name, version };
  }

  return null;
}

/**
 * Strip peer dependency suffix from version
 * E.g., "19.2.0(react@19.2.0)" -> "19.2.0"
 */
export function stripPeerDepSuffix(version: string): string {
  const parenIndex = version.indexOf("(");
  return parenIndex > 0 ? version.substring(0, parenIndex) : version;
}

/**
 * Check if a package key represents a git or tarball package (non-registry package)
 * These packages have version field stored separately and should not be parsed from the key.
 * Examples:
 *   - "package@git+https://github.com/..."
 *   - "package@github:user/repo#commit"
 *   - "package@https://example.com/package.tgz"
 */
export function isGitPackageKey(packageKey: string): boolean {
  return (
    packageKey.includes("@git+") ||
    packageKey.includes("@github:") ||
    packageKey.includes("@gitlab:") ||
    packageKey.includes("@https://") ||
    packageKey.includes("@http://")
  );
}

/**
 * Find the line number where a package key appears in the lockfile
 */
export function findLineNumber(content: string, packageKey: string): number | undefined {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for the package key at the start of a line (with optional indentation)
    if (line && line.trim().startsWith(`'${packageKey}':`)) {
      return i + 1; // Line numbers are 1-indexed
    }
    // Also check for unquoted keys
    if (line && line.trim().startsWith(`${packageKey}:`)) {
      return i + 1;
    }
  }
  return undefined;
}
