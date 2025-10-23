/**
 * Find the line number where a package is defined in a lockfile
 *
 * @param lockfileContent - The full content of the lockfile as a string
 * @param packageName - The name of the package (e.g., "react" or "@types/node")
 * @param version - The exact version string (e.g., "19.0.0")
 * @returns The line number (1-indexed) where the version is defined, or undefined if not found
 *
 * @example
 * ```ts
 * const content = await Bun.file('package-lock.json').text();
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || '';

    // Match the package entry - could be nested (e.g., "node_modules/vite/node_modules/postcss")
    // Check if the line contains "node_modules/packageName" (handles nested paths)
    if (line.includes(`node_modules/${packageName}"`) || line.includes(`"${packageName}"`)) {
      // Check if the next few lines contain the version
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const versionLine = lines[j] || '';
        if (versionLine.includes(`"version": "${version}"`)) {
          return j + 1; // Return the line number of the version (1-indexed)
        }
      }
    }
  }

  return undefined;
}
