import { PackageURL } from "packageurl-js";

/**
 * Create a Package URL (PURL) for a Python package
 * Format: pkg:pypi/package-name@version
 */
export function createPypiPurl(name: string, version?: string | null): string {
  // Normalize the package name (lowercase and replace underscores with hyphens)
  // PyPI treats names case-insensitively and treats - and _ as equivalent
  const normalizedName = normalizePythonName(name);

  return new PackageURL("pypi", null, normalizedName, version || null, null, null).toString();
}

/**
 * Normalize a Python package name
 */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

/**
 * Parse a package name from a PEP 508-style dependency specification.
 */
export function parsePythonDependencyName(spec: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;

  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|(?:git|hg|svn|bzr)\+)/.test(trimmed)) {
    return null;
  }

  const nameMatch = trimmed.match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)/);
  return nameMatch ? nameMatch[1] : null;
}

/**
 * Find the line number where a package appears in a TOML lockfile (pdm.lock, poetry.lock).
 * Looks for lines matching: name = "package-name"
 */
export function findTomlPackageLineNumber(
  lines: string[],
  packageName: string,
): number | undefined {
  const normalizedName = normalizePythonName(packageName);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith('name = "')) {
      const match = trimmed.match(/name = "([^"]+)"/);
      if (match && normalizePythonName(match[1]) === normalizedName) {
        return i + 1;
      }
    }
  }
  return undefined;
}
