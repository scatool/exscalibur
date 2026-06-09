import { PackageURL } from "packageurl-js";
import type { Node } from "./types.ts";
import { basename, dirname } from "node:path";

/**
 * Create a Package URL (PURL) for a Conan package
 * Format: pkg:conan/{name}@{version}[?rrev={rrev}]
 *
 * @param name - Package name (will be normalized to lowercase)
 * @param version - Package version
 * @param rrev - Recipe revision
 * @param local - Whether this is a local/editable package (adds "local=true" qualifier)
 * @returns PURL string
 */
export function createConanPurl(
  name: string,
  version: string,
  rrev?: string | null,
  local?: boolean,
): string {
  const normalizedName = normalizeConanName(name);

  const qualifiers: Record<string, string> = {};
  if (rrev) {
    qualifiers.rrev = rrev;
  }
  if (local) {
    qualifiers.local = "true";
  }

  return new PackageURL("conan", null, normalizedName, version, qualifiers, null).toString();
}

export function createLocalNodeConanPurl(node: Node, file: string): string {
  // Fallback to directory name if node name is not available
  const nodeName = node.name || basename(dirname(file));

  if (!nodeName) {
    throw new Error(`Unable to create PURL for local node: ${JSON.stringify(node)}`);
  }

  return createConanPurl(nodeName, node.version || "0.0.0", node.rrev, true);
}

/**
 * Normalize a Conan package name to lowercase
 * Conan package names are case-insensitive
 */
export function normalizeConanName(name: string): string {
  return name.toLowerCase();
}
