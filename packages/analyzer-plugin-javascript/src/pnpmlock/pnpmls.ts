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
 * Run `pnpm install --frozen-lockfile --ignore-scripts` followed by `pnpm ls -r --json --depth=Infinity` and parse the output
 *
 * @param cwd - The directory containing pnpm-lock.yaml
 * @returns Array of parsed pnpm ls output (one per workspace package, or single element for non-workspaces)
 *
 * @example
 * ```ts
 * const outputs = await runPnpmLs('/path/to/project');
 * for (const output of outputs) {
 *   console.log(output.name, output.dependencies);
 * }
 * ```
 */
export async function runPnpmLs(cwd: string): Promise<PnpmLsOutput[]> {
  // First, install packages from lockfile only (no scripts, frozen lockfile)
  const installProc = Bun.spawn(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  await installProc.exited;

  // Then run pnpm ls -r to get the dependency tree for all workspace packages
  // The -r flag is crucial for workspace support - it returns all packages in the workspace
  const proc = Bun.spawn(['pnpm', 'ls', '-r', '--json', '--depth=Infinity'], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  // Try parsing the output
  // For proper workspaces with a single pnpm-lock.yaml, this returns a single JSON array
  // For monorepos with multiple separate lockfiles, this might output multiple arrays (invalid JSON)
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed as PnpmLsOutput[];
    }
    // Fallback: wrap single object in array
    return [parsed as PnpmLsOutput];
  } catch {
    // If -r fails to produce valid JSON (e.g., multiple lockfiles in subdirectories),
    // fall back to non-recursive mode which works for single lockfiles
    const procNonRecursive = Bun.spawn(['pnpm', 'ls', '--json', '--depth=Infinity'], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
    });

    const outputNonRecursive = await new Response(procNonRecursive.stdout).text();
    await procNonRecursive.exited;

    const parsedNonRecursive = JSON.parse(outputNonRecursive);
    if (Array.isArray(parsedNonRecursive)) {
      return parsedNonRecursive as PnpmLsOutput[];
    }
    return [parsedNonRecursive as PnpmLsOutput];
  }
}

/**
 * Check if a dependency is a workspace/local package
 *
 * @param dep - The dependency to check
 * @returns True if this is a workspace package (has version or path indicating local link)
 */
export function isWorkspacePackage(dep: PnpmLsDependency): boolean {
  // Check version for workspace protocol (e.g., "link:../../packages/ui")
  if (typeof dep.version === 'string' && dep.version.startsWith('link:')) {
    return true;
  }

  // Check path property
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
 * @returns The relative path, or undefined if not a workspace package
 */
export function getWorkspacePath(dep: PnpmLsDependency): string | undefined {
  if (!isWorkspacePackage(dep)) {
    return undefined;
  }

  // First check if version has link protocol (e.g., "link:../../packages/ui")
  if (typeof dep.version === 'string' && dep.version.startsWith('link:')) {
    const relativePath = dep.version.replace(/^link:/, '');
    return relativePath;
  }

  // Otherwise check path property
  if (!dep.path) {
    return undefined;
  }

  // Remove file: or link: prefix if present
  const relativePath = dep.path.replace(/^(file:|link:)/, '');

  // If it's an absolute path, return as-is
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  return relativePath;
}
