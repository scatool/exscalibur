import { normalize } from "node:path/posix";
import { npmResolutionCandidates } from "../npm-resolution.ts";
import type { NpmRecord } from "../npm-graph.ts";
import { createBundleBoundaryResolver } from "./bundles.ts";

/** Resolve native locations, including links, without collapsing equal package identities. */
export function createPlacementResolver(
  packagesByLocation: Record<string, NpmRecord>,
  viewsByLocation: Map<string, string>,
  lockDirectory: string,
  lockfileVersion: 1 | 2 | 3,
) {
  // Resolve links only after all views exist, keeping native placement separate from PURLs.
  const followWorkspaceLink = (location: string, boundary?: string): string | undefined => {
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
      if (boundary !== undefined && !candidate.startsWith(`${boundary}/node_modules/`)) {
        return undefined;
      }
    }

    return viewsByLocation.get(candidate);
  };

  const resolvePlacement = (
    caller: string,
    name: string,
    boundary?: string,
  ): string | undefined => {
    for (const candidate of npmResolutionCandidates(caller, name, lockDirectory)) {
      if (boundary !== undefined && !candidate.startsWith(`${boundary}/node_modules/`)) break;
      if (!Object.hasOwn(packagesByLocation, candidate)) continue;
      // An existing unresolved nearer location must not fall through. Archive-local links
      // also cannot prove that an external workspace is the bundled artifact's package view.
      return followWorkspaceLink(candidate, boundary);
    }

    return undefined;
  };

  const bundleBoundary = createBundleBoundaryResolver(
    packagesByLocation,
    lockfileVersion,
    (caller, name, boundary) => resolvePlacement(caller, name, boundary) !== undefined,
  );

  const resolveDependency = (caller: string, name: string, scope: string) => {
    const boundary = bundleBoundary(caller, name, scope);
    return { target: resolvePlacement(caller, name, boundary), boundary };
  };

  return { followWorkspaceLink, resolveDependency };
}
