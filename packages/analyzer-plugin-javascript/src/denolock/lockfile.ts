/**
 * Deno lockfile parsing utilities
 * Supports lockfile versions 3 and above
 */

export interface DenoLockfile {
  version: string;
  packages?: {
    specifiers?: Record<string, string>;
    jsr?: Record<string, JsrPackageMetadata>;
    npm?: Record<string, NpmPackageMetadata>;
  };
  remote?: Record<string, string>;
  workspace?: Record<string, unknown>;
}

export interface JsrPackageMetadata {
  integrity: string;
  dependencies?: string[];
}

export interface NpmPackageMetadata {
  integrity: string;
  dependencies?: Record<string, string>;
}

/**
 * Parse a Deno lockfile (JSON format)
 */
export function parseDenoLockfile(content: string): DenoLockfile {
  return JSON.parse(content) as DenoLockfile;
}

/**
 * Parse a JSR package identifier
 * Format: jsr:@scope/name@version or @scope/name@version
 * Returns { scope, name, version }
 */
export function parseJsrPackage(identifier: string): {
  scope: string;
  name: string;
  version: string;
} | null {
  // Remove jsr: prefix if present
  const cleanId = identifier.startsWith('jsr:') ? identifier.slice(4) : identifier;

  // Match @scope/name@version
  const match = cleanId.match(/^(@[^/]+)\/([^@]+)@(.+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    scope: match[1],
    name: match[2],
    version: match[3],
  };
}

/**
 * Parse an npm package identifier
 * Format: npm:name@version or name@version
 * Returns { name, version }
 */
export function parseNpmPackage(identifier: string): {
  name: string;
  version: string;
} | null {
  // Remove npm: prefix if present
  const cleanId = identifier.startsWith('npm:') ? identifier.slice(4) : identifier;

  // Match name@version or @scope/name@version
  const atIndex = cleanId.lastIndexOf('@');
  if (atIndex === -1 || atIndex === 0) {
    return null;
  }

  const name = cleanId.slice(0, atIndex);
  const version = cleanId.slice(atIndex + 1);

  if (!name || !version) {
    return null;
  }

  return { name, version };
}

/**
 * Find the line number of a string in content
 */
export function findLineNumber(content: string, searchString: string): number | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.includes(searchString)) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return null;
}
