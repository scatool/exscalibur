import type { AnalyzerResult } from '@scatool/analyzer-core';

/** Validates an AnalyzerResult for common errors. Throws on failure. */
export function validateResult(result: AnalyzerResult): void {
  const subprojectPurls = new Set(result.subprojects.map((sp) => sp.purl));

  // Check for subproject purls in packages
  const subprojectsInPackages = result.packages.filter((pkg) => subprojectPurls.has(pkg.purl));
  if (subprojectsInPackages.length > 0) {
    const purls = subprojectsInPackages.map((p) => p.purl).join(', ');
    throw new Error(`Subproject purls found in packages array: ${purls}`);
  }

  // Check for subproject purls in relationships
  const subprojectsInRelationships: string[] = [];
  for (const rel of result.relationships) {
    if (subprojectPurls.has(rel.from)) {
      subprojectsInRelationships.push(rel.from);
    }
    for (const to of rel.to) {
      if (subprojectPurls.has(to)) {
        subprojectsInRelationships.push(to);
      }
    }
  }

  if (subprojectsInRelationships.length > 0) {
    const purls = [...new Set(subprojectsInRelationships)].join(', ');
    throw new Error(`Subproject purls found in relationships: ${purls}`);
  }

  // Check for duplicate package purls
  const packagePurls = result.packages.map((pkg) => pkg.purl);
  const duplicatePackages = packagePurls.filter((purl, index) => packagePurls.indexOf(purl) !== index);
  if (duplicatePackages.length > 0) {
    const purls = [...new Set(duplicatePackages)].join(', ');
    throw new Error(`Duplicate package purls found: ${purls}`);
  }

  // Check for duplicate subproject purls
  const duplicateSubprojects = result.subprojects
    .map((sp) => sp.purl)
    .filter((purl, index, arr) => arr.indexOf(purl) !== index);

  if (duplicateSubprojects.length > 0) {
    const purls = [...new Set(duplicateSubprojects)].join(', ');
    throw new Error(`Duplicate subproject purls found: ${purls}`);
  }

  // Check for duplicate purls in relationship 'to' arrays
  for (const rel of result.relationships) {
    const duplicatesInTo = rel.to.filter((purl, index) => rel.to.indexOf(purl) !== index);
    if (duplicatesInTo.length > 0) {
      const purls = [...new Set(duplicatesInTo)].join(', ');
      throw new Error(`Duplicate purls in relationship 'to' array for '${rel.from}': ${purls}`);
    }
  }
}
