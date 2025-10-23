/**
 * Types and utilities for working with `pnpm ls` JSON output
 */

/**
 * Represents a dependency entry in the pnpm ls output
 */
export interface PnpmLsDependency {
  /** The installed version of the package */
  version: string;
  /** The resolved URL (for published packages) or file path (for workspace packages) */
  path?: string;
  /** Whether this package is private */
  private?: boolean;
  /** Nested dependencies of this package */
  dependencies?: Record<string, PnpmLsDependency>;
}

/**
 * The top-level structure of `pnpm ls --json` output
 */
export interface PnpmLsOutput {
  /** The root package version */
  version?: string;
  /** The root package name */
  name?: string;
  /** Whether this is a private package */
  private?: boolean;
  /** Direct dependencies of the root package */
  dependencies?: Record<string, PnpmLsDependency>;
  /** Dev dependencies of the root package */
  devDependencies?: Record<string, PnpmLsDependency>;
  /** Optional dependencies of the root package */
  optionalDependencies?: Record<string, PnpmLsDependency>;
}

/**
 * Run `pnpm install --frozen-lockfile --ignore-scripts` followed by `pnpm ls --json --depth=Infinity` and parse the output
 *
 * @param cwd - The directory containing pnpm-lock.yaml
 * @returns Parsed pnpm ls output
 *
 * @example
 * ```ts
 * const output = await runPnpmLs('/path/to/project');
 * console.log(output.dependencies);
 * ```
 */
export async function runPnpmLs(cwd: string): Promise<PnpmLsOutput> {
  // First, install packages from lockfile only (no scripts, frozen lockfile)
  const installProc = Bun.spawn(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await installProc.exited;

  // Then run pnpm ls to get the dependency tree
  const proc = Bun.spawn(['pnpm', 'ls', '--json', '--depth=Infinity'], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  // pnpm ls --json returns an array with one element for single projects
  // but for workspaces, it returns an array with multiple elements
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) {
    // For workspaces, we need to handle multiple packages
    // For now, return the first one (root) - we'll handle workspaces via dependencies
    if (parsed.length > 0) {
      return parsed[0] as PnpmLsOutput;
    }
  }

  return parsed as PnpmLsOutput;
}

/**
 * Check if a dependency is a workspace/local package
 *
 * @param dep - The dependency to check
 * @returns True if this is a workspace package (has path property pointing to local directory)
 */
export function isWorkspacePackage(dep: PnpmLsDependency): boolean {
  return typeof dep.path === 'string' && (
    dep.path.startsWith('file:') ||
    dep.path.includes('link:') ||
    !dep.path.includes('node_modules')
  );
}

/**
 * Get the relative path for a workspace package
 *
 * @param dep - The workspace dependency
 * @param baseDir - The base directory (where pnpm-lock.yaml is located)
 * @returns The relative path, or undefined if not a workspace package
 */
export function getWorkspacePath(dep: PnpmLsDependency, baseDir: string): string | undefined {
  if (!isWorkspacePackage(dep) || !dep.path) {
    return undefined;
  }

  // Remove file: or link: prefix if present
  let relativePath = dep.path.replace(/^(file:|link:)/, '');

  // If it's an absolute path, make it relative to baseDir
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  return relativePath;
}
