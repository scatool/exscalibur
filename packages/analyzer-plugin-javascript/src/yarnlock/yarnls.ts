/**
 * Types and utilities for working with `yarn list` JSON output (Yarn 1 Classic)
 */

/**
 * Represents a dependency entry in the yarn list output
 */
export interface YarnLsDependency {
  /** The name of the package */
  name: string;
  /** The installed version of the package */
  version: string;
  /** Nested dependencies of this package */
  children?: YarnLsDependency[];
  /** Whether this is a shadow/reference entry (not an actual installed package) */
  shadow?: boolean;
  /** Color indicator from yarn (bold = installed, dim = reference) */
  color?: string | null;
}

/**
 * The top-level structure of `yarn list --json` output
 */
export interface YarnLsOutput {
  /** Type indicator (always "tree" for yarn list) */
  type: string;
  /** The dependency tree data */
  data: {
    /** Type of tree */
    type: string;
    /** The tree structure */
    trees: YarnLsDependency[];
  };
}

/**
 * Runs `yarn list --json --depth=Infinity` and parses the output.
 *
 * Note: Yarn 1 outputs multiple JSON objects (one per line), not a single JSON array.
 * We need to parse each line separately.
 *
 * @param cwd - The directory containing yarn.lock
 * @returns Parsed yarn list output
 */
export async function runYarnLs(cwd: string): Promise<YarnLsDependency[]> {
  const proc = Bun.spawn(['yarn', 'list', '--json', '--depth=Infinity'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [output, exitCode, stderrOutput] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  // Check if yarn list succeeded
  if (exitCode !== 0) {
    throw new Error(`yarn list failed with exit code ${exitCode}: ${stderrOutput}`);
  }

  // Yarn 1 outputs newline-delimited JSON (multiple JSON objects, one per line)
  // We need to find the line with type "tree" which contains the dependency data
  const lines = output.trim().split('\n');

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as YarnLsOutput;
      if (parsed.type === 'tree' && parsed.data && parsed.data.trees) {
        // Parse the name@version format in each tree entry
        return parsed.data.trees.map((tree) => parseYarnDependency(tree));
      }
    } catch {
      // Skip invalid JSON lines
      continue;
    }
  }

  return [];
}

/**
 * Parse a yarn dependency entry, extracting name and version from the combined "name@version" format
 */
function parseYarnDependency(dep: YarnLsDependency): YarnLsDependency {
  // Yarn list outputs name in format "package@version" or "@scope/package@version"
  const { name, version } = extractNameAndVersion(dep.name);

  return {
    ...dep,
    name,
    version: version || dep.version, // Use extracted version, fallback to existing
    children: dep.children?.map((child) => parseYarnDependency(child)),
  };
}

/**
 * Extract package name and version from yarn's "name@version" format
 * Examples:
 *   "lodash@4.17.21" -> { name: "lodash", version: "4.17.21" }
 *   "@babel/core@7.12.3" -> { name: "@babel/core", version: "7.12.3" }
 */
function extractNameAndVersion(nameWithVersion: string): { name: string; version?: string } {
  // Handle scoped packages (@scope/package@version)
  if (nameWithVersion.startsWith('@')) {
    // Find the last @ which separates name from version
    const lastAtIndex = nameWithVersion.lastIndexOf('@');
    if (lastAtIndex > 0) {
      return {
        name: nameWithVersion.substring(0, lastAtIndex),
        version: nameWithVersion.substring(lastAtIndex + 1),
      };
    }
  } else {
    // Handle regular packages (package@version)
    const atIndex = nameWithVersion.indexOf('@');
    if (atIndex > 0) {
      return {
        name: nameWithVersion.substring(0, atIndex),
        version: nameWithVersion.substring(atIndex + 1),
      };
    }
  }

  // No version found, return name as-is
  return { name: nameWithVersion };
}

/**
 * Check if a dependency is a workspace/local package.
 * In Yarn 1, workspace packages typically have version like "0.0.0" or match workspace protocol,
 * or they may have references to workspace packages using "*" versions that are marked as shadow.
 *
 * @param dep - The dependency to check
 * @param workspaceNames - Optional set of known workspace package names
 * @returns True if this is a workspace package
 */
export function isWorkspacePackage(dep: YarnLsDependency, workspaceNames?: Set<string>): boolean {
  // Yarn 1 workspace packages often have version "0.0.0" or start with "workspace:"
  if (!dep.version) {
    return false;
  }

  // Check for explicit workspace markers
  if (dep.version === '0.0.0' || dep.version.startsWith('workspace:')) {
    return true;
  }

  // If we have a list of known workspace names, check against it
  // This helps identify workspace packages that have real versions
  if (workspaceNames && workspaceNames.has(dep.name)) {
    return true;
  }

  return false;
}
