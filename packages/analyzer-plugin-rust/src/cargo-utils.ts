import { PackageURL } from 'packageurl-js';

/**
 * Standard Cargo dependency scope names.
 * Note: Cargo.lock does not distinguish between dependency types,
 * so all dependencies are reported in a single "dependencies" scope.
 */
export const CARGO_DEPENDENCY_SCOPES = ['dependencies'] as const;

/**
 * Type representing valid Cargo dependency scopes
 */
export type CargoDependencyScope = (typeof CARGO_DEPENDENCY_SCOPES)[number];

/**
 * Creates a Package URL (PURL) for a Cargo package.
 *
 * @param name - The package name (e.g., "serde")
 * @param version - The package version
 * @returns A PURL string (e.g., "pkg:cargo/serde@1.0.193")
 *
 * @example
 * createCargoPurl('serde', '1.0.193')
 * // => 'pkg:cargo/serde@1.0.193'
 */
export function createCargoPurl(name: string, version: string): string {
  return new PackageURL('cargo', null, name, version, null, null).toString();
}
