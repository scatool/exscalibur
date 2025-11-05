import type { Package, Relationship, Subproject } from './index.ts';

/**
 * Type for package map entries used during extraction
 */
export type PackageMapEntry = {
  purl: string;
  evidence: Set<string>;
};

/**
 * Adds a relationship between two packages.
 * Creates a new relationship entry if one doesn't exist for the 'from' package.
 *
 * @param relationshipsMap - The map to add the relationship to
 * @param from - The source package PURL
 * @param to - The target package PURL
 */
export function addRelationship(relationshipsMap: Map<string, Set<string>>, from: string, to: string): void {
  const existing = relationshipsMap.get(from);
  if (existing) {
    existing.add(to);
  } else {
    relationshipsMap.set(from, new Set([to]));
  }
}

/**
 * Ensures a package exists in the package map.
 * Creates a new entry with an empty evidence set if the package doesn't exist.
 *
 * @param packageMap - The map to check/update
 * @param purl - The package PURL to ensure exists
 */
export function ensurePackageExists(packageMap: Map<string, PackageMapEntry>, purl: string): void {
  if (!packageMap.has(purl)) {
    packageMap.set(purl, { purl, evidence: new Set() });
  }
}

/**
 * Adds evidence to a package in the package map.
 * Ensures the package exists before adding evidence.
 *
 * @param packageMap - The map containing packages
 * @param purl - The package PURL
 * @param evidence - The evidence string to add (e.g., "file.lock#123")
 */
export function addPackageEvidence(packageMap: Map<string, PackageMapEntry>, purl: string, evidence: string): void {
  ensurePackageExists(packageMap, purl);
  packageMap.get(purl)!.evidence.add(evidence);
}

/**
 * Converts a package map to an array of Package objects.
 * Sorts evidence arrays for consistency.
 *
 * @param packageMap - The map to convert
 * @returns Array of Package objects
 */
export function convertPackageMapToArray(packageMap: Map<string, PackageMapEntry>): Package[] {
  return Array.from(packageMap.values()).map(({ purl, evidence }) => ({
    purl,
    evidence: Array.from(evidence),
  }));
}

/**
 * Converts a relationships map to an array of Relationship objects.
 * Sorts the 'to' arrays for consistency.
 *
 * @param relationshipsMap - The map to convert
 * @returns Array of Relationship objects
 */
export function convertRelationshipsMapToArray(relationshipsMap: Map<string, Set<string>>): Relationship[] {
  return Array.from(relationshipsMap.entries()).map(([from, toSet]) => ({
    from,
    to: Array.from(toSet),
  }));
}

/**
 * Aggregates all dependencies from subprojects and adds them as relationships.
 * For each subproject, collects all packages from all scopes and creates a relationship
 * from the subproject to each of those packages.
 *
 * @param subprojects - Array of subprojects to process
 * @param relationshipsMap - The map to add relationships to
 */
export function aggregateSubprojectRelationships(
  subprojects: Subproject[],
  relationshipsMap: Map<string, Set<string>>,
): void {
  for (const subproject of subprojects) {
    const allDeps = new Set<string>();
    for (const scope of subproject.scopes) {
      for (const pkg of scope.packages) {
        allDeps.add(pkg);
      }
    }

    if (allDeps.size > 0) {
      const existing = relationshipsMap.get(subproject.purl);
      if (existing) {
        allDeps.forEach((dep) => existing.add(dep));
      } else {
        relationshipsMap.set(subproject.purl, allDeps);
      }
    }
  }
}

/**
 * Initializes the standard maps used during extraction.
 *
 * @returns An object containing initialized packageMap and relationshipsMap
 */
export function initializeExtractionMaps(): {
  packageMap: Map<string, PackageMapEntry>;
  relationshipsMap: Map<string, Set<string>>;
} {
  return {
    packageMap: new Map<string, PackageMapEntry>(),
    relationshipsMap: new Map<string, Set<string>>(),
  };
}
