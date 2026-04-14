import type { AnalyzerResult, Issue, Package, Relationship, Subproject } from './types.ts';

export type PackageMapEntry = {
  purl: string;
  evidence: Set<string>;
};

export function addRelationship(relationshipsMap: Map<string, Set<string>>, from: string, to: string): void {
  const existing = relationshipsMap.get(from);
  if (existing) {
    existing.add(to);
  } else {
    relationshipsMap.set(from, new Set([to]));
  }
}

export function ensurePackageExists(packageMap: Map<string, PackageMapEntry>, purl: string): void {
  if (!packageMap.has(purl)) {
    packageMap.set(purl, { purl, evidence: new Set() });
  }
}

export function addPackageEvidence(packageMap: Map<string, PackageMapEntry>, purl: string, evidence: string): void {
  ensurePackageExists(packageMap, purl);
  packageMap.get(purl)!.evidence.add(evidence);
}

export function convertPackageMapToArray(packageMap: Map<string, PackageMapEntry>): Package[] {
  return Array.from(packageMap.values()).map(({ purl, evidence }) => ({
    purl,
    evidence: Array.from(evidence),
  }));
}

export function convertRelationshipsMapToArray(relationshipsMap: Map<string, Set<string>>): Relationship[] {
  return Array.from(relationshipsMap.entries()).map(([from, toSet]) => ({
    from,
    to: Array.from(toSet),
  }));
}

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

export function initializeExtractionMaps(): {
  packageMap: Map<string, PackageMapEntry>;
  relationshipsMap: Map<string, Set<string>>;
} {
  return {
    packageMap: new Map<string, PackageMapEntry>(),
    relationshipsMap: new Map<string, Set<string>>(),
  };
}

export function buildResult(
  packageMap: Map<string, PackageMapEntry>,
  relationshipsMap: Map<string, Set<string>>,
  subprojects: Subproject[],
  issues?: Issue[],
): AnalyzerResult {
  return {
    packages: convertPackageMapToArray(packageMap),
    subprojects,
    relationships: convertRelationshipsMapToArray(relationshipsMap),
    issues: issues || [],
  };
}

export function errorResult(file: string, lockfileName: string, error: unknown): AnalyzerResult {
  return {
    packages: [],
    subprojects: [],
    relationships: [],
    issues: [
      {
        message: `Failed to parse ${lockfileName}: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'ERROR',
        file,
      },
    ],
  };
}
