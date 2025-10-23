/**
 * Utilities for working with pnpm-lock.yaml files
 */

/**
 * Find the line number where a package is defined in a pnpm-lock.yaml file
 *
 * @param lockfileContent - The full content of the lockfile as a string
 * @param packageName - The name of the package (e.g., "react" or "@types/node")
 * @param version - The exact version string (e.g., "19.0.0")
 * @returns The line number (1-indexed) where the package is defined, or undefined if not found
 *
 * @example
 * ```ts
 * const content = await Bun.file('pnpm-lock.yaml').text();
 * const lineNumber = findPackageInLockfile(content, 'react', '19.0.0');
 * // Returns line number like 1234
 * ```
 */
export function findPackageInLockfile(
  lockfileContent: string,
  packageName: string,
  version: string,
): number | undefined {
  const lines = lockfileContent.split('\n');

  // pnpm-lock.yaml uses different formats depending on lockfile version:
  // Lockfile v9+ (newer):
  //   react@19.0.0:
  //   @types/react@19.0.0:
  // Older versions:
  //   /react@19.0.0:
  //   /@types/react@19.0.0:
  //   /react@19.0.0_@types+react@19.0.0:  (with peer deps)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Check for both formats: with and without leading slash
    // Pattern 1 (v9+): "  react@19.0.0:"
    // Pattern 2 (older): "  /react@19.0.0:"
    const pattern1 = `${packageName}@${version}:`;
    const pattern2 = `/${packageName}@${version}:`;

    if (trimmed.startsWith(pattern1) || trimmed.startsWith(pattern2)) {
      return i + 1; // Return 1-indexed line number
    }

    // Also check for quoted package names (for packages with special chars)
    const quotedPattern1 = `'${packageName}@${version}':`;
    const quotedPattern2 = `'/${packageName}@${version}':`;

    if (trimmed.startsWith(quotedPattern1) || trimmed.startsWith(quotedPattern2)) {
      return i + 1; // Return 1-indexed line number
    }
  }

  return undefined;
}
