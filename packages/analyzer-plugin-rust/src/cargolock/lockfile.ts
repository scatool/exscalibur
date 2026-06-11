import { parse as parseToml } from "smol-toml";

export type CargoLockPackage = {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
  dependencies?: string[];
};

type CargoLockfile = {
  version: number;
  package: CargoLockPackage[];
};

type CargoToml = {
  package?: {
    name?: string;
    version?: string;
  };
  workspace?: {
    members?: string[];
  };
};

/**
 * Parse a Cargo.lock file (TOML format).
 */
export function parseCargoLockfile(content: string): CargoLockfile {
  return parseToml(content) as CargoLockfile;
}

/**
 * Parse a Cargo.toml file (TOML format).
 */
export function parseCargoToml(content: string): CargoToml {
  return parseToml(content) as CargoToml;
}

/**
 * Parse a dependency string from Cargo.lock
 * Dependencies can be in the format:
 * - "package-name" (version inferred)
 * - "package-name 1.0.0" (explicit version)
 * - "package-name 1.0.0 (source+url)" (explicit version and source for disambiguation)
 *
 * Returns { name, version, source } with version/source optional
 */
export function parseDependency(dep: string): { name: string; version?: string; source?: string } {
  // Check for source disambiguation format: "name version (source)"
  const sourceMatch = dep.match(/^(.+?) (\S+) \((.+)\)$/);
  if (sourceMatch) {
    return {
      name: sourceMatch[1]!,
      version: sourceMatch[2],
      source: sourceMatch[3],
    };
  }

  const parts = dep.split(" ");
  if (parts.length === 1) {
    return { name: parts[0]! };
  } else if (parts.length === 2) {
    return { name: parts[0]!, version: parts[1] };
  } else {
    // Fallback: treat entire string as name
    return { name: dep };
  }
}

/**
 * Find the line number where a package appears in the Cargo.lock content
 * Looks for the [[package]] header followed by name = "package-name"
 */
export function findLineNumber(content: string, packageName: string): number | undefined {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === `name = "${packageName}"`) {
      // Return the line number (1-indexed)
      return i + 1;
    }
  }

  return undefined;
}

/**
 * Check if a package is a workspace member (no source field)
 */
export function isWorkspacePackage(pkg: CargoLockPackage): boolean {
  return !pkg.source;
}
