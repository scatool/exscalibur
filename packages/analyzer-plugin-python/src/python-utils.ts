import { PackageURL } from "packageurl-js";

/**
 * Create a Package URL (PURL) for a Python package
 * Format: pkg:pypi/package-name@version
 */
export function createPypiPurl(name: string, version: string): string {
  // Normalize the package name (lowercase and replace underscores with hyphens)
  // PyPI treats names case-insensitively and treats - and _ as equivalent
  const normalizedName = name.toLowerCase().replace(/_/g, "-");

  return new PackageURL("pypi", "", normalizedName, version, null, null).toString();
}

/**
 * Normalize a Python package name
 */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
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
