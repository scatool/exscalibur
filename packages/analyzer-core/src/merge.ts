import type { AnalyzerResult } from "./types.ts";
import { normalizeResult } from "./normalize.ts";

/**
 * Merge multiple AnalyzerResult objects into a single result
 * - Deduplicates packages by purl, merging evidence arrays
 * - Concatenates all subprojects
 * - Merges relationships with the same 'from' value
 * - Concatenates all issues
 * - Normalizes and sorts the final result
 */
export function mergeResults(results: AnalyzerResult[]): AnalyzerResult {
  const packageMap = new Map<string, { purl: string; evidence: string[] }>();
  const subprojects: Array<{
    purl: string;
    definitionFile: string;
    scopes: Array<{ scope: string; packages: string[] }>;
  }> = [];
  const relationshipMap = new Map<string, Set<string>>();
  const issues: Array<{ message: string; severity: "HINT" | "WARNING" | "ERROR"; file?: string }> =
    [];

  for (const result of results) {
    // Merge packages
    for (const pkg of result.packages) {
      const existing = packageMap.get(pkg.purl);
      if (existing) {
        // Merge evidence arrays
        existing.evidence.push(...pkg.evidence);
      } else {
        // Create new entry
        packageMap.set(pkg.purl, {
          purl: pkg.purl,
          evidence: [...pkg.evidence],
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
