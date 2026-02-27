import { PackageURL } from 'packageurl-js';

/**
 * Create a Package URL (PURL) for a Python package
 * Format: pkg:pypi/package-name@version
 */
export function createPypiPurl(name: string, version: string): string {
  // Normalize the package name (lowercase and replace underscores with hyphens)
  // PyPI treats names case-insensitively and treats - and _ as equivalent
  const normalizedName = name.toLowerCase().replace(/_/g, '-');

  return new PackageURL('pypi', '', normalizedName, version, null, null).toString();
}

/**
 * Common Python dependency scopes
 */
export const PYTHON_DEPENDENCY_SCOPES = ['dependencies', 'dev-dependencies', 'optional-dependencies', 'group'] as const;

/**
 * Parse a version string from various formats
 * Handles: "==1.2.3", "1.2.3", ">=1.2.3,<2.0.0", etc.
 */
export function parseVersion(versionStr: string): string | null {
  // Remove whitespace
  versionStr = versionStr.trim();

  // If it starts with ==, extract the exact version
  if (versionStr.startsWith('==')) {
    return versionStr.substring(2).trim();
  }

  // If it's a simple version number without operators
  if (/^[\d.]+/.test(versionStr)) {
    const match = versionStr.match(/^([\d.]+)/);
    return match ? match[1] : null;
  }

  return null;
}

/**
 * Normalize a Python package name
 */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}
