import { PackageURL } from 'packageurl-js';

/**
 * Standard npm dependency scope names.
 * These correspond to the dependency types in package.json files.
 */
export const NPM_DEPENDENCY_SCOPES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/**
 * Type representing valid npm dependency scopes
 */
export type NpmDependencyScope = (typeof NPM_DEPENDENCY_SCOPES)[number];

/**
 * Creates a Package URL (PURL) for an npm package.
 * Handles scoped packages by extracting the namespace from the package name.
 *
 * @param name - The package name (e.g., "react" or "@babel/core")
 * @param version - The package version
 * @returns A PURL string (e.g., "pkg:npm/babel/core@7.0.0")
 *
 * @example
 * createNpmPurl('react', '18.0.0')
 * // => 'pkg:npm/react@18.0.0'
 *
 * createNpmPurl('@babel/core', '7.0.0')
 * // => 'pkg:npm/babel/core@7.0.0'
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
