/**
 * Find a package in a yarn.lock file and return the line number
 *
 * Yarn 1 lockfile format:
 * package-name@version-range:
 *   version "resolved-version"
 *   resolved "https://..."
 *   ...
 *
 * @param lockfileContent - The content of yarn.lock
 * @param packageName - The name of the package to find
 * @param version - The resolved version to match
 * @returns The line number where the package is found, or undefined
 */
export function findPackageInLockfile(
  lockfileContent: string,
  packageName: string,
  version: string,
): number | undefined {
  const lines = lockfileContent.split('\n');

  // Search for the package entry
  // Format is: "package-name@^1.0.0", package-name@^1.0.0, or "@scope/package@^1.0.0"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Check if this line is a package declaration (starts at column 0, ends with :)
    if (line.match(/^[^#\s].*:$/)) {
      // This is a package declaration line
      // Check if it contains our package name
      if (line.includes(packageName)) {
        // Look ahead to find the version line (should be within next few lines)
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const versionLine = lines[j];
          if (!versionLine) continue;

          // Check for version line (indented, starts with "version ")
          const versionMatch = versionLine.match(/^\s+version\s+"(.+)"/);
          if (versionMatch && versionMatch[1] === version) {
            // Found it! Return the line number of the package declaration
            return i + 1; // Line numbers are 1-indexed
          }

          // If we hit another package declaration, stop looking
          if (versionLine.match(/^[^#\s].*:$/)) {
            break;
          }
        }
      }
    }
  }

  return undefined;
}
