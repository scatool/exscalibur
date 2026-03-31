import {
  type AnalyzerResult,
  type Extractor,
  type Subproject,
  type DependencyScope,
  filesExtractor,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { PackageURL } from 'packageurl-js';

export const extractor: Extractor = filesExtractor({
  name: 'spdx',
  version: 1,
  markFiles: async function (codebase: string) {
    await scanAndMarkFiles(this, codebase, '**/*.spdx.json', []);
    await scanAndMarkFiles(this, codebase, '**/*.spdx.jsonld', []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    return extractSpdx(content, file);
  },
});

// --- Types ---

type SpdxCreationInfo = {
  specVersion?: string;
};

type SpdxExternalIdentifier = {
  externalIdentifierType?: string;
  identifier?: string;
};

type SpdxElement = {
  // Compacted form
  type?: string;
  spdxId?: string;
  // Expanded form
  '@type'?: string;
  '@id'?: string;
  // Package fields
  name?: string;
  packageUrl?: string;
  software_packageUrl?: string;
  packageVersion?: string;
  externalIdentifier?: SpdxExternalIdentifier[];
  // Relationship fields
  relationshipType?: string;
  from?: string;
  to?: string[];
  // LifecycleScopedRelationship fields
  scope?: string;
  // CreationInfo (inline or blank node reference)
  creationInfo?: string | SpdxCreationInfo;
};

type SpdxDocument = {
  // Compacted form
  type?: string;
  spdxId?: string;
  creationInfo?: string | SpdxCreationInfo;
  element?: SpdxElement[];
  rootElement?: string[];
  // Expanded form
  '@type'?: string;
  '@id'?: string;
  '@graph'?: SpdxElement[];
  '@context'?: unknown;
};

// --- JSON-LD accessors ---

function getType(el: { type?: string; '@type'?: string }): string | undefined {
  return el.type ?? el['@type'];
}

function getId(el: { spdxId?: string; '@id'?: string }): string | undefined {
  return el.spdxId ?? el['@id'];
}

function getElements(doc: SpdxDocument): SpdxElement[] {
  return doc.element ?? doc['@graph'] ?? [];
}

function getRootElements(doc: SpdxDocument): string[] {
  return doc.rootElement ?? [];
}

function typeIncludes(typeValue: string | undefined, name: string): boolean {
  if (!typeValue) return false;
  return (
    typeValue === name ||
    typeValue.endsWith(`/${name}`) ||
    typeValue.endsWith(`:${name}`) ||
    typeValue.endsWith(`_${name}`)
  );
}

// --- Extraction ---

type ScopedDep = {
  fromPurl: string;
  toPurl: string;
  scope: string;
};

export function extractSpdx(content: string, filePath?: string): AnalyzerResult {
  try {
    const doc: SpdxDocument = JSON.parse(content);

    // For expanded JSON-LD with @graph, the document root may be in the graph
    // or the top-level object itself may be the document
    const elements = getElements(doc);

    // Validate: check if this is an SPDX document
    const docType = getType(doc);
    const isDocumentRoot = docType && typeIncludes(docType, 'SpdxDocument');

    // If the top-level has no type but has @graph, look for SpdxDocument in graph
    let specVersion: string | undefined;

    if (isDocumentRoot) {
      specVersion = resolveSpecVersion(doc, elements);
    } else if (elements.length > 0) {
      // Look for SpdxDocument in graph elements
      const docElement = elements.find((el) => typeIncludes(getType(el), 'SpdxDocument'));
      if (docElement) {
        specVersion = resolveSpecVersion(docElement as SpdxDocument, elements);
      }
    }

    if (!specVersion) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                message: `Not an SPDX 3.0.x document (could not determine specVersion)`,
                severity: 'WARNING',
                file: filePath,
              },
            ]
          : [],
      };
    }

    if (!specVersion.startsWith('3.0')) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                message: `Unsupported SPDX version: ${specVersion} (expected 3.0.x)`,
                severity: 'WARNING',
                file: filePath,
              },
            ]
          : [],
      };
    }

    // Step 1: Build spdxId → PURL map from Package elements
    const packages: Array<{ purl: string; evidence: string[] }> = [];
    const spdxIdToPurl = new Map<string, string>();

    for (const el of elements) {
      const elType = getType(el);
      if (!typeIncludes(elType, 'Package')) continue;

      const purl = extractPurl(el);
      if (!purl) continue;

      let validatedPurl: string;
      try {
        const parsed = PackageURL.fromString(purl);
        validatedPurl = parsed.toString();
      } catch {
        continue;
      }

      const elId = getId(el);
      if (elId) {
        spdxIdToPurl.set(elId, validatedPurl);
      }

      const evidence: string[] = [];
      if (filePath) {
        evidence.push(filePath);
      }

      packages.push({ purl: validatedPurl, evidence });
    }

    // Step 2: Build relationships from Relationship and LifecycleScopedRelationship elements
    const scopedDeps: ScopedDep[] = [];

    // Accumulate all dependsOn relationships by fromPurl for merging
    const relationshipMap = new Map<string, Set<string>>();

    for (const el of elements) {
      const elType = getType(el);
      const isRelationship = typeIncludes(elType, 'Relationship');
      const isLifecycleScoped = typeIncludes(elType, 'LifecycleScopedRelationship');

      if (!isRelationship && !isLifecycleScoped) continue;
      if (el.relationshipType !== 'dependsOn') continue;

      const fromId = el.from;
      if (!fromId) continue;
      const fromPurl = spdxIdToPurl.get(fromId);
      if (!fromPurl) continue;

      const toIds = el.to;
      if (!toIds || toIds.length === 0) continue;

      for (const toId of toIds) {
        const toPurl = spdxIdToPurl.get(toId);
        if (!toPurl) continue;

        // Add to relationship map
        const existing = relationshipMap.get(fromPurl);
        if (existing) {
          existing.add(toPurl);
        } else {
          relationshipMap.set(fromPurl, new Set([toPurl]));
        }

        // Track scoped deps for subproject building
        if (isLifecycleScoped && el.scope) {
          scopedDeps.push({ fromPurl, toPurl, scope: el.scope });
        }
      }
    }

    // Step 3 will determine subproject PURLs, so defer relationship array building

    // Step 3: Build subprojects from rootElement references
    const rootElementIds = getRootElements(doc);
    // Also check for SpdxDocument in graph that may have rootElement
    if (rootElementIds.length === 0) {
      for (const el of elements) {
        if (typeIncludes(getType(el), 'SpdxDocument')) {
          const docEl = el as unknown as SpdxDocument;
          const roots = getRootElements(docEl);
          rootElementIds.push(...roots);
          break;
        }
      }
    }

    const subprojects: Subproject[] = [];

    for (const rootId of rootElementIds) {
      const rootPurl = spdxIdToPurl.get(rootId);
      if (!rootPurl) continue;

      // Group scoped deps by scope for this root
      const scopeMap = new Map<string, string[]>();

      // Collect scoped deps where from matches this root
      for (const dep of scopedDeps) {
        if (dep.fromPurl !== rootPurl) continue;
        const existing = scopeMap.get(dep.scope);
        if (existing) {
          existing.push(dep.toPurl);
        } else {
          scopeMap.set(dep.scope, [dep.toPurl]);
        }
      }

      // Collect unscoped dependsOn for this root into "dependencies" scope
      const allScopedToPurls = new Set(scopedDeps.filter((d) => d.fromPurl === rootPurl).map((d) => d.toPurl));
      const unscopedDeps = relationshipMap.get(rootPurl);
      if (unscopedDeps) {
        const unscopedPurls: string[] = [];
        for (const toPurl of unscopedDeps) {
          if (!allScopedToPurls.has(toPurl)) {
            unscopedPurls.push(toPurl);
          }
        }
        if (unscopedPurls.length > 0) {
          const existing = scopeMap.get('dependencies');
          if (existing) {
            existing.push(...unscopedPurls);
          } else {
            scopeMap.set('dependencies', unscopedPurls);
          }
        }
      }

      const scopes: DependencyScope[] = [];
      for (const [scope, pkgs] of scopeMap) {
        scopes.push({ scope, packages: pkgs });
      }

      subprojects.push({
        purl: rootPurl,
        definitionFile: filePath ?? '',
        scopes,
      });
    }

    // Exclude subproject PURLs from packages and relationships
    const subprojectPurls = new Set(subprojects.map((sp) => sp.purl));

    const filteredPackages = packages.filter((pkg) => !subprojectPurls.has(pkg.purl));

    const filteredRelationships: Array<{ from: string; to: string[] }> = [];
    for (const [from, toSet] of relationshipMap) {
      if (subprojectPurls.has(from)) continue;
      const filteredTo = Array.from(toSet).filter((to) => !subprojectPurls.has(to));
      if (filteredTo.length > 0) {
        filteredRelationships.push({ from, to: filteredTo });
      }
    }

    return {
      packages: filteredPackages,
      subprojects,
      relationships: filteredRelationships,
      issues: [],
    };
  } catch (error) {
    return {
      packages: [],
      subprojects: [],
      relationships: [],
      issues: filePath
        ? [
            {
              message: `Failed to parse SPDX document: ${error instanceof Error ? error.message : String(error)}`,
              severity: 'ERROR',
              file: filePath,
            },
          ]
        : [],
    };
  }
}

function extractPurl(el: SpdxElement): string | undefined {
  // Check direct packageUrl field first (compacted or expanded form)
  if (el.packageUrl) {
    return el.packageUrl;
  }
  if (el.software_packageUrl) {
    return el.software_packageUrl;
  }

  // Fall back to externalIdentifier array
  if (el.externalIdentifier) {
    for (const extId of el.externalIdentifier) {
      if (
        extId.externalIdentifierType &&
        typeIncludes(extId.externalIdentifierType, 'packageUrl') &&
        extId.identifier
      ) {
        return extId.identifier;
      }
    }
  }

  return undefined;
}

function resolveSpecVersion(docOrElement: SpdxDocument | SpdxElement, elements: SpdxElement[]): string | undefined {
  const creationInfo = docOrElement.creationInfo;
  if (!creationInfo) return undefined;

  if (typeof creationInfo === 'string') {
    // It's a blank node reference — look it up in elements
    const infoElement = elements.find((el) => getId(el) === creationInfo);
    if (infoElement?.creationInfo && typeof infoElement.creationInfo !== 'string') {
      return infoElement.creationInfo.specVersion;
    }
    // The blank node itself might have specVersion directly on the element
    const blankNode = elements.find((el) => getId(el) === creationInfo) as unknown as SpdxCreationInfo | undefined;
    return blankNode?.specVersion;
  }

  return creationInfo.specVersion;
}
