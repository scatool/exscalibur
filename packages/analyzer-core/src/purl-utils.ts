import { PackageURL } from 'packageurl-js';

/**
 * Creates a Package URL (PURL) for an npm package.
 * Handles scoped packages by extracting the namespace from the package name.
 *
 * @param name - The package name (e.g., "react" or "@babel/core")
 * @param version - The package version
 * @returns A PURL string (e.g., "pkg:npm/babel/core@7.0.0")
 */
export function createNpmPurl(name: string, version: string): string {
  let namespace: string | null = null;
  let packageName = name;

  if (name.startsWith('@')) {
    const parts = name.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      namespace = parts[0];
      packageName = parts[1];
    }
  }

  return new PackageURL('npm', namespace, packageName, version, null, null).toString();
}

/**
 * Creates a Package URL (PURL) for a Go module.
 *
 * @param name - The module name (e.g., "github.com/pkg/errors")
 * @param version - The module version
 * @returns A PURL string
 */
export function createGoPurl(name: string, version: string): string {
  return new PackageURL('golang', null, name, version, null, null).toString();
}

/**
 * Creates a generic Package URL (PURL).
 *
 * @param type - The package type (e.g., "npm", "golang", "pypi")
 * @param name - The package name
 * @param version - The package version
 * @param namespace - Optional namespace for the package
 * @returns A PURL string
 */
export function createPurl(type: string, name: string, version: string, namespace: string | null = null): string {
  return new PackageURL(type, namespace, name, version, null, null).toString();
}
