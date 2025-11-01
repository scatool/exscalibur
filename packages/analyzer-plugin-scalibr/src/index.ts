import { type AnalyzerResult, type Extractor } from '@scatool/analyzer-core/src/index.ts';
import { $ } from 'bun';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const extractor: Extractor = {
  name: 'scalibr',
  version: 1,
  extract: async (codebase: string): Promise<AnalyzerResult> => {
    return await extractScalibr(codebase);
  },
};

export type SPDXPackage = {
  SPDXID: string;
  name: string;
  versionInfo?: string;
  externalRefs?: Array<{
    referenceCategory: string;
    referenceType: string;
    referenceLocator: string;
  }>;
};

export type SPDXFile = {
  SPDXID: string;
  fileName: string;
};

export type SPDXRelationship = {
  spdxElementId: string;
  relationshipType: string;
  relatedSpdxElement: string;
};

export type SPDXDocument = {
  spdxVersion: string;
  packages?: SPDXPackage[];
  files?: SPDXFile[];
  relationships?: SPDXRelationship[];
};

async function extractScalibr(codebase: string): Promise<AnalyzerResult> {
  // Check if scalibr is available
  try {
    await $`which scalibr`.quiet();
  } catch {
    console.warn('scalibr binary not found in PATH, skipping extraction');
    return {
      packages: [],
      subprojects: [],
      relationships: [],
    };
  }

  // Create a temporary file for output
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scalibr-'));
  const outputPath = path.join(tmpDir, 'result.spdx.json');

  try {
    // Run scalibr with SPDX JSON output
    // Use --root to specify the codebase directory
    await $`scalibr --root ${codebase} -o spdx23-json=${outputPath}`.quiet();

    // Read and parse the SPDX JSON output
    const spdxContent = await fs.readFile(outputPath, 'utf-8');
    const spdxDoc: SPDXDocument = JSON.parse(spdxContent);

    // Convert to AnalyzerResult
    return convertSPDXToAnalyzerResult(spdxDoc, codebase);
  } catch (error) {
    console.error('Error running scalibr:', error);
    return {
      packages: [],
      subprojects: [],
      relationships: [],
    };
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function convertSPDXToAnalyzerResult(spdxDoc: SPDXDocument, codebase: string): AnalyzerResult {
  const packages: Array<{ purl: string; evidence: string[] }> = [];
  const relationships: Array<{ from: string; to: string[] }> = [];

  // Map SPDXID to file paths for evidence
  const spdxIdToFiles = new Map<string, string[]>();
  if (spdxDoc.files) {
    for (const file of spdxDoc.files) {
      spdxIdToFiles.set(file.SPDXID, [file.fileName]);
    }
  }

  // Build a map of package SPDXID to related file SPDXIDs
  const packageToFiles = new Map<string, string[]>();
  if (spdxDoc.relationships) {
    for (const rel of spdxDoc.relationships) {
      // CONTAINS relationship: package contains file
      if (rel.relationshipType === 'CONTAINS') {
        const files = packageToFiles.get(rel.spdxElementId) || [];
        files.push(rel.relatedSpdxElement);
        packageToFiles.set(rel.spdxElementId, files);
      }
    }
  }

  // Process packages
  if (spdxDoc.packages) {
    for (const pkg of spdxDoc.packages) {
      // Extract PURL from externalRefs
      let purl: string | null = null;
      if (pkg.externalRefs) {
        for (const ref of pkg.externalRefs) {
          if (ref.referenceType === 'purl' && ref.referenceLocator) {
            purl = ref.referenceLocator;
            break;
          }
        }
      }

      // If no PURL in externalRefs, try to construct one from name and version
      if (!purl && pkg.name) {
        // This is a fallback - ideally scalibr provides proper PURLs
        const version = pkg.versionInfo || '';
        // We don't know the type, so we'll use 'generic'
        purl = `pkg:generic/${encodeURIComponent(pkg.name)}${version ? '@' + encodeURIComponent(version) : ''}`;
      }

      if (purl) {
        // Collect evidence from related files
        const evidence: string[] = [];
        const relatedFileIds = packageToFiles.get(pkg.SPDXID) || [];
        for (const fileId of relatedFileIds) {
          const filePaths = spdxIdToFiles.get(fileId) || [];
          for (const filePath of filePaths) {
            // Make path relative to codebase if it's absolute
            const relativePath = filePath.startsWith('/')
              ? path.relative(codebase, filePath)
              : filePath;
            if (relativePath && !relativePath.startsWith('..')) {
              evidence.push(path.join(codebase, relativePath));
            }
          }
        }

        packages.push({
          purl,
          evidence,
        });
      }
    }
  }

  // Process relationships for dependency graphs
  // Map SPDXID to PURL
  const spdxIdToPurl = new Map<string, string>();
  if (spdxDoc.packages) {
    for (const pkg of spdxDoc.packages) {
      if (pkg.externalRefs) {
        for (const ref of pkg.externalRefs) {
          if (ref.referenceType === 'purl' && ref.referenceLocator) {
            spdxIdToPurl.set(pkg.SPDXID, ref.referenceLocator);
            break;
          }
        }
      }
    }
  }

  // Build relationship map
  const relationshipMap = new Map<string, Set<string>>();
  if (spdxDoc.relationships) {
    for (const rel of spdxDoc.relationships) {
      // DEPENDS_ON or DEPENDENCY_OF relationships
      if (rel.relationshipType === 'DEPENDS_ON' || rel.relationshipType === 'DEPENDENCY_OF') {
        const fromPurl = spdxIdToPurl.get(rel.spdxElementId);
        const toPurl = spdxIdToPurl.get(rel.relatedSpdxElement);

        if (fromPurl && toPurl) {
          const deps = relationshipMap.get(fromPurl) || new Set<string>();
          deps.add(toPurl);
          relationshipMap.set(fromPurl, deps);
        }
      }
    }
  }

  // Convert relationship map to array
  for (const [from, toSet] of relationshipMap.entries()) {
    relationships.push({
      from,
      to: Array.from(toSet),
    });
  }

  return {
    packages,
    subprojects: [],
    relationships,
  };
}
