import { PackageURL } from 'packageurl-js';

/**
 * Creates a Package URL (PURL) for a Go module.
 *
 * @param modulePath - The module path (e.g., "github.com/pkg/errors")
 * @param version - The module version (optional)
 * @returns A PURL string
 *
 * @example
 * createGoPurl('github.com/pkg/errors', 'v0.9.1')
 * // => 'pkg:golang/github.com/pkg/errors@v0.9.1'
 *
 * @example
 * createGoPurl('github.com/pkg/errors')
 * // => 'pkg:golang/github.com/pkg/errors'
 */
export function createGoPurl(modulePath: string, version?: string): string {
  return new PackageURL('golang', null, modulePath, version ?? null, null, null).toString();
}
