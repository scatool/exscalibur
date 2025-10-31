/**
 * Yarn 1 (Classic) lockfile parser
 *
 * Yarn 1 lockfiles use a custom text format (not JSON, not YAML):
 * - Package entries start with one or more package patterns (e.g., "name@range", "@scope/name@range")
 * - Multiple patterns can reference the same resolution (comma-separated on multiple lines)
 * - The version field contains the resolved version
 * - Dependencies are listed under `dependencies` and `optionalDependencies` keys
 */

/**
 * Represents a parsed package entry from yarn.lock
 */
export interface YarnLockPackage {
  /** The resolved version of this package */
  version: string;
  /** The URL where the package was resolved from */
  resolved?: string;
  /** Integrity hash */
  integrity?: string;
  /** Regular dependencies */
  dependencies?: Record<string, string>;
  /** Optional dependencies */
  optionalDependencies?: Record<string, string>;
}

/**
 * Parsed yarn.lock file structure
 */
export interface YarnLockfile {
  /** Map of package key patterns to their resolved packages */
  packages: Map<string, YarnLockPackage>;
}

/**
 * Parse a yarn.lock file (Yarn 1 Classic format)
 *
 * The format is a custom text-based format:
 * ```
 * package-name@^1.0.0, package-name@~1.0.0:
 *   version "1.0.5"
 *   resolved "https://..."
 *   integrity sha512-...
 *   dependencies:
 *     dep-name "^2.0.0"
 * ```
 */
export function parseYarnLockfile(content: string): YarnLockfile {
  const packages = new Map<string, YarnLockPackage>();
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    // Check if this is a package header (starts at column 0, contains @, ends with :)
    // Examples: "lodash@^4.17.21:", "@babel/core@^7.0.0, @babel/core@^7.1.0:"
    if (line.match(/^[^#\s].*@.*:$/)) {
      const { patterns, packageEntry, nextIndex } = parsePackageEntry(lines, i);

      // Add this package for each pattern
      for (const pattern of patterns) {
        packages.set(pattern, packageEntry);
      }

      i = nextIndex;
    } else {
      i++;
    }
  }

  return { packages };
}

/**
 * Parse a single package entry starting at the given line index
 * Returns the package patterns, the parsed package, and the next line index to process
 */
function parsePackageEntry(
  lines: string[],
  startIndex: number,
): {
  patterns: string[];
  packageEntry: YarnLockPackage;
  nextIndex: number;
} {
  const packageEntry: YarnLockPackage = {
    version: '',
  };

  // Parse the header line(s) to extract package patterns
  const patterns: string[] = [];
  let i = startIndex;

  // Collect all header lines (patterns can span multiple lines)
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;

    // If this line starts with non-whitespace and contains @, it's part of the header
    if (line.match(/^[^#\s].*@/)) {
      // Remove trailing colon and split by comma
      const cleanLine = line.replace(/:$/, '').trim();
      const parts = cleanLine
        .split(',')
        .map((p) => {
          // Remove quotes if present
          let cleaned = p.trim();
          if (
            (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
            (cleaned.startsWith("'") && cleaned.endsWith("'"))
          ) {
            cleaned = cleaned.slice(1, -1);
          }
          return cleaned;
        })
        .filter((p) => p);
      patterns.push(...parts);
      i++;
    } else {
      break;
    }
  }

  // Now parse the indented properties
  let currentDepsType: 'dependencies' | 'optionalDependencies' | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line - continue
    if (!line || line.trim() === '') {
      i++;
      continue;
    }

    // If we hit a non-indented line, we're done with this package
    if (!line.match(/^\s/)) {
      break;
    }

    const indentLevel = line.search(/\S/);
    const trimmed = line.trim();

    // Top-level properties (2 spaces indent)
    if (indentLevel === 2) {
      currentDepsType = null;

      if (trimmed.startsWith('version ')) {
        packageEntry.version = trimmed.match(/version "(.+)"/)?.[1] || '';
      } else if (trimmed.startsWith('resolved ')) {
        packageEntry.resolved = trimmed.match(/resolved "(.+)"/)?.[1] || '';
      } else if (trimmed.startsWith('integrity ')) {
        packageEntry.integrity = trimmed.match(/integrity (.+)/)?.[1] || '';
      } else if (trimmed === 'dependencies:') {
        currentDepsType = 'dependencies';
        packageEntry.dependencies = {};
      } else if (trimmed === 'optionalDependencies:') {
        currentDepsType = 'optionalDependencies';
        packageEntry.optionalDependencies = {};
      }
    }
    // Dependency entries (4 spaces indent)
    else if (indentLevel === 4 && currentDepsType) {
      const match = trimmed.match(/^(.+?)\s+"(.+)"$/);
      if (match && match[1] && match[2]) {
        const depName = match[1];
        const depVersion = match[2];
        packageEntry[currentDepsType]![depName] = depVersion;
      }
    }

    i++;
  }

  return { patterns, packageEntry, nextIndex: i };
}

/**
 * Extract package name and version from a yarn package pattern
 * Examples:
 *   "lodash@^4.17.21" -> { name: "lodash", versionRange: "^4.17.21" }
 *   "@babel/core@^7.0.0" -> { name: "@babel/core", versionRange: "^7.0.0" }
 *   "lodash@4.17.21" -> { name: "lodash", versionRange: "4.17.21" }
 */
export function parsePackagePattern(pattern: string): { name: string; versionRange: string } | null {
  // Find the last @ (version separator)
  // For scoped packages (@babel/core@^7.0.0), this skips the scope @
  const lastAtIndex = pattern.lastIndexOf('@');
  if (lastAtIndex > 0) {
    const name = pattern.substring(0, lastAtIndex);
    const versionRange = pattern.substring(lastAtIndex + 1);
    return { name, versionRange };
  }

  return null;
}

/**
 * Find the line number where a package is defined in the lockfile
 * Searches for a package pattern that matches the given name and resolved version
 */
export function findLineNumber(
  content: string,
  lockfile: YarnLockfile,
  packageName: string,
  resolvedVersion: string,
): number | undefined {
  const lines = content.split('\n');

  // Find all patterns that resolve to this package
  const matchingPatterns: string[] = [];
  for (const [pattern, pkg] of lockfile.packages.entries()) {
    if (pkg.version === resolvedVersion) {
      const parsed = parsePackagePattern(pattern);
      if (parsed && parsed.name === packageName) {
        matchingPatterns.push(pattern);
        break; // Found a match, no need to continue
      }
    }
  }

  if (matchingPatterns.length === 0) {
    return undefined;
  }

  // Search for the first matching pattern in the file
  const targetPattern = matchingPatterns[0];
  if (!targetPattern) {
    return undefined;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.includes(targetPattern) && line.match(/^[^#\s].*@.*:/)) {
      return i + 1; // Line numbers are 1-indexed
    }
  }

  return undefined;
}

/**
 * Resolve the actual installed version for a package name and version range
 * by looking it up in the lockfile's packages map
 */
export function resolvePackageVersion(
  lockfile: YarnLockfile,
  packageName: string,
  versionRange: string,
): string | null {
  // Create the pattern to look up
  const pattern = `${packageName}@${versionRange}`;

  // Look up in the packages map
  const pkg = lockfile.packages.get(pattern);
  return pkg ? pkg.version : null;
}
