/**
 * Yarn Berry (Modern) lockfile parser
 *
 * Yarn Berry (v2+) lockfiles use YAML format:
 * - Package entries use keys like "name@npm:version" or "name@workspace:path"
 * - Workspace packages have version "0.0.0-use.local" and linkType "soft"
 * - Regular packages have semantic versions and linkType "hard"
 * - Dependencies can reference multiple package patterns (comma-separated in key)
 */

/**
 * Represents a parsed package entry from yarn.lock (Yarn Berry)
 */
export interface YarnBerryLockPackage {
  /** The resolved version of this package */
  version: string;
  /** The resolution string (e.g., "package@npm:1.2.3") */
  resolution?: string;
  /** Checksum hash */
  checksum?: string;
  /** Regular dependencies */
  dependencies?: Record<string, string>;
  /** Optional dependencies */
  optionalDependencies?: Record<string, string>;
  /** Peer dependencies */
  peerDependencies?: Record<string, string>;
  /** Link type: "hard" for regular packages, "soft" for workspace packages */
  linkType?: string;
  /** Language name */
  languageName?: string;
  /** The original combined pattern from the lockfile (for evidence tracking) */
  originalPattern?: string;
}

/**
 * Parsed yarn.lock file structure (Yarn Berry)
 */
export interface YarnBerryLockfile {
  /** Lockfile version (e.g., 8) */
  version?: number;
  /** Cache key */
  cacheKey?: string;
  /** Map of package key patterns to their resolved packages */
  packages: Map<string, YarnBerryLockPackage>;
}

/**
 * Parse a yarn.lock file (Yarn Berry/Modern format)
 *
 * This is a YAML format, so we'll use a YAML parser.
 */
export function parseYarnBerryLockfile(content: string): YarnBerryLockfile {
  // We need to parse YAML - using a simple approach for now
  // In production, we'd use a proper YAML parser, but for this implementation
  // we'll parse it manually to avoid adding dependencies

  const packages = new Map<string, YarnBerryLockPackage>();
  const lines = content.split("\n");

  let i = 0;
  let version: number | undefined;
  let cacheKey: string | undefined;

  // Parse metadata section
  while (i < lines.length) {
    const line = lines[i];

    if (line && line.trim() === "__metadata:") {
      i++;
      // Parse metadata fields
      while (i < lines.length && lines[i]?.match(/^\s{2}[a-zA-Z]/)) {
        const metaLine = lines[i]?.trim();
        if (metaLine?.startsWith("version:")) {
          version = parseInt(metaLine.split(":")[1]?.trim() || "0", 10);
        } else if (metaLine?.startsWith("cacheKey:")) {
          cacheKey = metaLine.split(":")[1]?.trim();
        }
        i++;
      }
      break;
    }
    i++;
  }

  // Parse package entries
  i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Package entry starts with a quoted or unquoted string at the beginning of the line
    // Examples:
    //   "@emnapi/runtime@npm:^1.5.0":
    //   express@expressjs/express:
    if (line && (line.match(/^"[^"]+":$/) || line.match(/^[^":\s][^:]*:$/))) {
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

  return { version, cacheKey, packages };
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
  packageEntry: YarnBerryLockPackage;
  nextIndex: number;
} {
  const packageEntry: YarnBerryLockPackage = {
    version: "",
  };

  // Parse the header line to extract package patterns
  const headerLine = lines[startIndex];
  if (!headerLine) {
    return { patterns: [], packageEntry, nextIndex: startIndex + 1 };
  }

  // Remove quotes and trailing colon
  // Quoted: "@emnapi/runtime@npm:^1.5.0": -> @emnapi/runtime@npm:^1.5.0
  // Quoted with multiple: "@scatest/ui@npm:*, @scatest/ui@workspace:packages/ui": -> @scatest/ui@npm:*, @scatest/ui@workspace:packages/ui
  // Unquoted: express@expressjs/express: -> express@expressjs/express
  let cleanHeader = headerLine.trim();
  if (cleanHeader.startsWith('"') && cleanHeader.endsWith('":')) {
    cleanHeader = cleanHeader.slice(1, -2); // Remove leading " and trailing ":
  } else if (cleanHeader.endsWith(":")) {
    cleanHeader = cleanHeader.slice(0, -1); // Remove trailing :
  }

  // Split by comma to get multiple patterns
  const patterns = cleanHeader
    .split(", ")
    .map((p) => p.trim())
    .filter((p) => p);

  // Store the original combined pattern for evidence tracking
  packageEntry.originalPattern = cleanHeader;

  let i = startIndex + 1;
  let currentDepsType: "dependencies" | "optionalDependencies" | "peerDependencies" | null = null;

  // Parse indented properties
  while (i < lines.length) {
    const line = lines[i];

    // Empty line - continue
    if (!line || line.trim() === "") {
      i++;
      continue;
    }

    // If we hit a non-indented line (next package or metadata), we're done
    if (!line.match(/^\s/)) {
      break;
    }

    const indentLevel = line.search(/\S/);
    const trimmed = line.trim();

    // Top-level properties (2 spaces indent)
    if (indentLevel === 2) {
      currentDepsType = null;

      if (trimmed.startsWith("version:")) {
        packageEntry.version = trimmed.replace("version:", "").trim();
      } else if (trimmed.startsWith("resolution:")) {
        packageEntry.resolution = trimmed
          .replace("resolution:", "")
          .trim()
          .replace(/^"/, "")
          .replace(/"$/, "");
      } else if (trimmed.startsWith("checksum:")) {
        packageEntry.checksum = trimmed.replace("checksum:", "").trim();
      } else if (trimmed.startsWith("linkType:")) {
        packageEntry.linkType = trimmed.replace("linkType:", "").trim();
      } else if (trimmed.startsWith("languageName:")) {
        packageEntry.languageName = trimmed.replace("languageName:", "").trim();
      } else if (trimmed === "dependencies:") {
        currentDepsType = "dependencies";
        packageEntry.dependencies = {};
      } else if (trimmed === "optionalDependencies:") {
        currentDepsType = "optionalDependencies";
        packageEntry.optionalDependencies = {};
      } else if (trimmed === "peerDependencies:") {
        currentDepsType = "peerDependencies";
        packageEntry.peerDependencies = {};
      }
    }
    // Dependency entries (4 spaces indent)
    else if (indentLevel === 4 && currentDepsType) {
      // Format: depName: "npm:^1.0.0" or depName: npm:^1.0.0
      // depName might be quoted for scoped packages: "@scatest/ui": npm:*
      const match = trimmed.match(/^(.+?):\s*"?([^"]+)"?$/);
      if (match && match[1] && match[2]) {
        let depName = match[1].trim();
        // Remove quotes from dependency name if present
        if (
          (depName.startsWith('"') && depName.endsWith('"')) ||
          (depName.startsWith("'") && depName.endsWith("'"))
        ) {
          depName = depName.slice(1, -1);
        }
        const depVersion = match[2].trim();
        packageEntry[currentDepsType]![depName] = depVersion;
      }
    }

    i++;
  }

  return { patterns, packageEntry, nextIndex: i };
}

/**
 * Extract package name and version from a Yarn Berry package pattern
 *
 * Patterns can be:
 * - "lodash@npm:^4.17.21" -> { name: "lodash", type: "npm", versionOrPath: "^4.17.21" }
 * - "@babel/core@npm:^7.0.0" -> { name: "@babel/core", type: "npm", versionOrPath: "^7.0.0" }
 * - "@scatest/ui@workspace:packages/ui" -> { name: "@scatest/ui", type: "workspace", versionOrPath: "packages/ui" }
 * - "express@https://github.com/..." -> { name: "express", type: "git", versionOrPath: "https://..." }
 * - "react-16@npm:react@^16.0.0" -> { name: "react", type: "npm-alias", versionOrPath: "^16.0.0", alias: "react-16" }
 */
export function parsePackagePattern(pattern: string): {
  name: string;
  type: "npm" | "workspace" | "git" | "tarball" | "npm-alias" | "patch" | "link" | "portal";
  versionOrPath: string;
  alias?: string;
} | null {
  // Check for special protocols that should be skipped: patch:, link:, portal:
  const patchMatch = pattern.match(/^(.+)@patch:(.+)$/);
  if (patchMatch && patchMatch[1] && patchMatch[2]) {
    return {
      name: patchMatch[1],
      type: "patch",
      versionOrPath: patchMatch[2],
    };
  }

  const linkMatch = pattern.match(/^(.+)@link:(.+)$/);
  if (linkMatch && linkMatch[1] && linkMatch[2]) {
    return {
      name: linkMatch[1],
      type: "link",
      versionOrPath: linkMatch[2],
    };
  }

  const portalMatch = pattern.match(/^(.+)@portal:(.+)$/);
  if (portalMatch && portalMatch[1] && portalMatch[2]) {
    return {
      name: portalMatch[1],
      type: "portal",
      versionOrPath: portalMatch[2],
    };
  }

  // Check for workspace packages
  const workspaceMatch = pattern.match(/^(.+)@workspace:(.+)$/);
  if (workspaceMatch && workspaceMatch[1] && workspaceMatch[2]) {
    return {
      name: workspaceMatch[1],
      type: "workspace",
      versionOrPath: workspaceMatch[2],
    };
  }

  // Check for npm package aliases (e.g., "react-16@npm:react@^16.0.0")
  // This matches patterns where the package name appears twice with @npm: in between
  const npmAliasMatch = pattern.match(/^(.+)@npm:(.+)@(.+)$/);
  if (npmAliasMatch && npmAliasMatch[1] && npmAliasMatch[2] && npmAliasMatch[3]) {
    return {
      name: npmAliasMatch[2], // The actual package name (e.g., "react")
      type: "npm-alias",
      versionOrPath: npmAliasMatch[3], // The version (e.g., "^16.0.0")
      alias: npmAliasMatch[1], // The alias (e.g., "react-16")
    };
  }

  // Check for regular npm packages
  const npmMatch = pattern.match(/^(.+)@npm:(.+)$/);
  if (npmMatch && npmMatch[1] && npmMatch[2]) {
    return {
      name: npmMatch[1],
      type: "npm",
      versionOrPath: npmMatch[2],
    };
  }

  // Check for tarball packages (registry tarballs) - must be checked before git
  // since the git regex would also match tarball URLs
  const tarballMatch = pattern.match(/^(.+)@(https?:\/\/.+\.tgz.*)$/);
  if (tarballMatch && tarballMatch[1] && tarballMatch[2]) {
    return {
      name: tarballMatch[1],
      type: "tarball",
      versionOrPath: tarballMatch[2],
    };
  }

  // Check for git packages (https://)
  const gitMatch = pattern.match(/^(.+)@(https?:\/\/.+)$/);
  if (gitMatch && gitMatch[1] && gitMatch[2]) {
    return {
      name: gitMatch[1],
      type: "git",
      versionOrPath: gitMatch[2],
    };
  }

  return null;
}

/**
 * Find the line number where a package is defined in the lockfile
 */
export function findLineNumber(content: string, packageKey: string): number | undefined {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for the quoted package key at the start of a line
    if (line && (line === `"${packageKey}":` || line.includes(`"${packageKey}":`))) {
      return i + 1; // Line numbers are 1-indexed
    }
  }

  return undefined;
}

/**
 * Resolve the actual installed version for a package name and version range
 * by looking it up in the lockfile's packages map
 *
 * Implements fallback logic similar to Blackduck and FOSSA:
 * 1. Try exact match with npm: protocol
 * 2. Try without protocol
 * 3. Search all entries for this package and find best match
 */
export function resolvePackageVersion(
  lockfile: YarnBerryLockfile,
  packageName: string,
  versionRange: string,
): string | null {
  // Normalize version range - strip npm: prefix if present
  let normalizedRange = versionRange;
  if (normalizedRange.startsWith("npm:")) {
    normalizedRange = normalizedRange.substring(4);
  }

  // 1. Try npm: protocol with normalized range (most common)
  let pattern = `${packageName}@npm:${normalizedRange}`;
  let pkg = lockfile.packages.get(pattern);
  if (pkg && pkg.version !== "0.0.0-use.local") return pkg.version;

  // 2. Try without protocol (for git/tarball dependencies like "owner/repo#commit")
  pattern = `${packageName}@${normalizedRange}`;
  pkg = lockfile.packages.get(pattern);
  if (pkg && pkg.version !== "0.0.0-use.local") return pkg.version;

  // 3. Try with original range if different from normalized
  if (versionRange !== normalizedRange) {
    pattern = `${packageName}@${versionRange}`;
    pkg = lockfile.packages.get(pattern);
    if (pkg && pkg.version !== "0.0.0-use.local") return pkg.version;
  }

  // 4. Search all lockfile entries for this package name and find any match
  // This handles cases where the exact range doesn't match but the package exists
  for (const [entryPattern, entryPkg] of lockfile.packages.entries()) {
    if (entryPkg.version === "0.0.0-use.local") continue;

    const parsed = parsePackagePattern(entryPattern);
    if (parsed && parsed.name === packageName) {
      // Found a match for this package - return its version
      // Note: This may not be the exact range requested, but it's better than nothing
      // In a more sophisticated implementation, we'd do semver range matching here
      return entryPkg.version;
    }
  }

  return null;
}
