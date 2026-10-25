import { normalize } from "node:path/posix";
import { npmResolutionCandidates } from "../npm-resolution.ts";
import type { NpmRecord } from "../npm-graph.ts";

/** Resolve native locations, including links, without collapsing equal package identities. */
export function createPlacementResolver(
  packagesByLocation: Record<string, NpmRecord>,
  viewsByLocation: Map<string, string>,
  lockDirectory: string,
) {
  // Resolve links only after all views exist, keeping native placement separate from PURLs.
  const followWorkspaceLink = (location: string): string | undefined => {
    const visited = new Set<string>();
    let candidate = location;
    while (packagesByLocation[candidate]?.link === true) {
      if (visited.has(candidate)) throw new Error(`Cyclic npm workspace links at '${candidate}'`);
      visited.add(candidate);
      const destination = packagesByLocation[candidate]?.resolved;
      if (typeof destination !== "string" || destination.length === 0)
        throw new Error(`Invalid npm link destination at '${candidate}'`);
      candidate = normalize(destination.replace(/^file:/, ""));
      if (candidate === ".") candidate = "";
    }

    return viewsByLocation.get(candidate);
  };

  const resolveDependency = (caller: string, name: string): string | undefined => {
    for (const candidate of npmResolutionCandidates(caller, name, lockDirectory)) {
      if (!Object.hasOwn(packagesByLocation, candidate)) continue;
      return followWorkspaceLink(candidate); // An existing unresolved nearer location must not fall through.
    }

    return undefined;
  };

  return { followWorkspaceLink, resolveDependency };
}
