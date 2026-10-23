import { basename, dirname, join, relative, resolve } from "node:path";

/** Enumerate real lexical ancestors, returning lockfile-relative placement keys. No filesystem reads. */
export function npmResolutionCandidates(
  callerPath: string,
  name: string,
  lockDirectory: string,
): string[] {
  const candidates: string[] = [];
  let directory = resolve(lockDirectory, callerPath);
  while (true) {
    if (basename(directory) !== "node_modules") {
      candidates.push(
        relative(lockDirectory, join(directory, "node_modules", name)).replaceAll("\\", "/"),
      );
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return candidates;
}
