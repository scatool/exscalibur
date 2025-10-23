/**
 * Represents a dependency entry in the npm ls output
 */
export interface NpmLsDependency {
  /** The installed version of the package */
  version: string;
  /** The resolved URL (for published packages) or file path (for workspace packages) */
  resolved?: string;
  /** Whether this is an overridden dependency */
  overridden?: boolean;
  /** Nested dependencies of this package */
  dependencies?: Record<string, NpmLsDependency>;
  /** Problems with this dependency (missing, invalid, etc.) */
  problems?: string[];
}

/**
 * The top-level structure of `npm ls --json` output
 */
export interface NpmLsOutput {
  /** The root package version */
  version?: string;
  /** The root package name */
  name?: string;
  /** Direct dependencies of the root package */
  dependencies?: Record<string, NpmLsDependency>;
  /** Any problems encountered during dependency resolution */
  problems?: string[];
}

/**
 * Runs `npm ls --json --all --package-lock-only` and parses the output.
 *
 * @param cwd - The directory containing package-lock.json
 * @returns Parsed npm ls output
 */
export async function runNpmLs(cwd: string): Promise<NpmLsOutput> {
  const proc = Bun.spawn(['npm', 'ls', '--json', '--all', '--package-lock-only'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  return JSON.parse(output) as NpmLsOutput;
}

/**
 * Check if a dependency is a workspace/local package.
 *
 * @param dep - The dependency to check
 * @returns True if this is a workspace package (resolved to file:...)
 */
export function isWorkspacePackage(dep: NpmLsDependency): boolean {
  return typeof dep.resolved === 'string' && dep.resolved.startsWith('file:');
}

/**
 * Get the relative path for a workspace package
 *
 * @param dep - The workspace dependency
 * @returns The relative path, or undefined if not a workspace package
 */
export function getWorkspacePath(dep: NpmLsDependency): string | undefined {
  if (!isWorkspacePackage(dep)) {
    return undefined;
  }

  // TODO: this is likely wrong, please evaluate
  let relativePath = dep.resolved!.replace('file:', '');
  if (relativePath.startsWith('../')) {
    // Remove the ../../ prefix and just use the last parts
    const parts = relativePath.split('/').filter((p) => p !== '..' && p !== '.');
    relativePath = parts.join('/');
  }

  return relativePath;
}
