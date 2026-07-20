import type { AnalyzerResult, IssueSeverity } from "./types.ts";

/**
 * Normalize and sort an AnalyzerResult for deterministic output.
 * Uses lexicographic comparison for locale-independent and consistent sorting across environments.
 */
export function normalizeResult(result: AnalyzerResult): AnalyzerResult {
  const sortedPackages = result.packages
    .map((pkg) => ({
      purl: pkg.purl,
      evidence: [...pkg.evidence].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ...(pkg.externalReferences !== undefined && {
        externalReferences: [...pkg.externalReferences].sort((a, b) => {
          if (a.type !== b.type) return a.type < b.type ? -1 : 1;
          return a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0;
        }),
      }),
    }))
    .sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));

  const sortedSubprojects = result.subprojects
    .map((sub) => ({
      purl: sub.purl,
      definitionFile: sub.definitionFile,
      scopes: sub.scopes
        .map((scope) => ({
          scope: scope.scope,
          packages: [...scope.packages].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        }))
        .sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0)),
    }))
    .sort((a, b) => {
      if (a.purl !== b.purl) return a.purl < b.purl ? -1 : 1;
      return a.definitionFile < b.definitionFile ? -1 : a.definitionFile > b.definitionFile ? 1 : 0;
    });

  const sortedRelationships = result.relationships
    .map((rel) => ({
      from: rel.from,
      to: [...rel.to].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const severityOrder: Record<IssueSeverity, number> = { ERROR: 0, WARNING: 1, HINT: 2 };
  const sortedIssues = [...result.issues].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    if (!a.file && !b.file) return 0;
    if (!a.file) return 1;
    if (!b.file) return -1;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });

  return {
    packages: sortedPackages,
    subprojects: sortedSubprojects,
    relationships: sortedRelationships,
    issues: sortedIssues,
  };
}
