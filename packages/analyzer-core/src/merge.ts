import type { AnalyzerResult, ExternalReference, Issue, Package } from "./types.ts";
import { normalizeResult } from "./normalize.ts";

/**
 * Merge multiple AnalyzerResult objects into a single result
 * - Deduplicates packages by purl, merging package metadata
 * - Concatenates all subprojects
 * - Merges relationships with the same 'from' value
 * - Concatenates all issues
 * - Normalizes and sorts the final result
 */
export function mergeResults(results: AnalyzerResult[]): AnalyzerResult {
  const packageMap = new Map<string, Package>();
  const subprojects: Array<{
    purl: string;
    definitionFile: string;
    scopes: Array<{ scope: string; packages: string[] }>;
  }> = [];
  const relationshipMap = new Map<string, Set<string>>();
  const issues: Issue[] = [];

  for (const result of results) {
    // Merge packages
    for (const pkg of result.packages) {
      const existing = packageMap.get(pkg.purl);
      if (existing) {
        // Merge package metadata
        existing.evidence.push(...pkg.evidence);
        existing.downloadLocation ??= pkg.downloadLocation;
        existing.externalReferences = mergeExternalReferences(
          existing.externalReferences,
          pkg.externalReferences,
        );
      } else {
        // Create new entry
        packageMap.set(pkg.purl, {
          purl: pkg.purl,
          evidence: [...pkg.evidence],
          ...(pkg.downloadLocation !== undefined && { downloadLocation: pkg.downloadLocation }),
          ...(pkg.externalReferences !== undefined && {
            externalReferences: mergeExternalReferences(undefined, pkg.externalReferences),
          }),
        });
      }
    }

    // Merge subprojects
    subprojects.push(...result.subprojects);

    // Merge relationships
    for (const rel of result.relationships) {
      const existing = relationshipMap.get(rel.from);
      if (existing) {
        for (const to of rel.to) {
          existing.add(to);
        }
      } else {
        relationshipMap.set(rel.from, new Set(rel.to));
      }
    }

    // Merge issues
    issues.push(...result.issues);
  }

  return normalizeResult({
    packages: Array.from(packageMap.values()),
    subprojects,
    relationships: Array.from(relationshipMap.entries()).map(([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    })),
    issues,
  });
}

function mergeExternalReferences(
  first?: ExternalReference[],
  second?: ExternalReference[],
): ExternalReference[] | undefined {
  if (first === undefined && second === undefined) return undefined;

  const references = new Map<string, ExternalReference>();
  for (const reference of [...(first ?? []), ...(second ?? [])]) {
    references.set(JSON.stringify([reference.type, reference.locator]), { ...reference });
  }
  return Array.from(references.values());
}
