export type CargoLockPackage = {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
  dependencies?: string[];
};

export type CargoLockfile = {
  version: number;
  package: CargoLockPackage[];
};

export type CargoToml = {
  package?: {
    name?: string;
    version?: string;
  };
  workspace?: {
    members?: string[];
  };
};

/**
 * Parse a Cargo.lock file (TOML format) using Bun's native TOML parser
 */
export function parseCargoLockfile(content: string): CargoLockfile {
  return Bun.TOML.parse(content) as CargoLockfile;
}

/**
 * Parse a Cargo.toml file (TOML format) using Bun's native TOML parser
 */
export function parseCargoToml(content: string): CargoToml {
  return Bun.TOML.parse(content) as CargoToml;
}

/**
 * Parse a dependency string from Cargo.lock
 * Dependencies can be in the format:
 * - "package-name" (version inferred)
 * - "package-name 1.0.0" (explicit version)
 *
 * Returns { name, version } or { name } if version not specified
 */
export function parseDependency(dep: string): { name: string; version?: string } {
  const parts = dep.split(' ');
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
  const lines = content.split('\n');

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
