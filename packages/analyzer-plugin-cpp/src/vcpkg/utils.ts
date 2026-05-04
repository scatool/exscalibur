import { PackageURL } from 'packageurl-js';

/**
 * Create a Package URL (PURL) for a Vcpkg package
 * Format: pkg:vcpkg/{name}@{version}[?rrev={rrev}]
 *
 * @param name - Package name (will be normalized to lowercase)
 * @param version - Package version
 * @param rrev - Recipe revision
 * @param local - Whether this is a local/editable package (adds "local=true" qualifier)
 * @returns PURL string
 */
export function createVcpkgPurl(name: string, version: string, local?: boolean): string {
  const normalizedName = normalizeVcpkgName(name);

  const qualifiers: Record<string, string> = {};
  if (local) {
    qualifiers.local = 'true';
  }

  return new PackageURL('vcpkg', null, normalizedName, version, qualifiers, null).toString();
}

/**
 * Normalize a Vcpkg package name to lowercase
 * Vcpkg package names are case-insensitive
 */
export function normalizeVcpkgName(name: string): string {
  return name.toLowerCase();
}

/**
 * Find the line numbers where a vcpkg reference appears in the content
 * @param name - The package name
 * @param content - The content to search
 * @returns An array of line (zero-indexed) numbers where the reference appears
 */
export function retrieveVcpkgReferenceLineNumber(name: string, content: string): number[] {
  // for now, just search for the package name in quotes, e.g. "zlib"
  const target = `"${name}"`;
  const lines = content.split('\n');
  return lines
    .map((line, index) => {
      // map lines to their index for later retrieval
      return { line, index };
    })
    .filter(({ line }) => line.includes(target))
    .map(({ index }) => index);
}
