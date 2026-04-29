import {
  type AnalyzerResult,
  type Extractor,
  type Subproject,
  type DependencyScope,
  filesExtractor,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { PackageURL } from 'packageurl-js';
import { optionSchema, type SpdxOptions } from './options.ts';

export const extractor: Extractor<SpdxOptions> = filesExtractor<SpdxOptions>({
  name: 'spdx',
  version: 1,
  options: async () => ({
    ignore: [],
  }),
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: SpdxOptions) {
    await scanAndMarkFiles(this, codebase, '**/*.spdx.{json,jsonld}', options.ignore ?? []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    return extractSpdx(content, file);
  },
});

type SpdxCreationInfo = {
  specVersion?: string;
};

type SpdxExternalIdentifier = {
  externalIdentifierType?: string;
  identifier?: string;
};

type SpdxElement = {
  type?: string;
  spdxId?: string;
  '@type'?: string;
  '@id'?: string;
  name?: string;
  packageUrl?: string;
  software_packageUrl?: string;
  packageVersion?: string;
  externalIdentifier?: SpdxExternalIdentifier[];
  relationshipType?: string;
  from?: string;
  to?: string[];
  scope?: string;
  rootElement?: string[];
  creationInfo?: string | SpdxCreationInfo;
};

type SpdxDocument = {
  type?: string;
  spdxId?: string;
  creationInfo?: string | SpdxCreationInfo;
  element?: SpdxElement[];
  rootElement?: string[];
  '@type'?: string;
  '@id'?: string;
  '@graph'?: SpdxElement[];
  '@context'?: unknown;
};

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

type ScopedDep = {
  fromPurl: string;
  toPurl: string;
  scope: string;
};

export function extractSpdx(content: string, filePath?: string): AnalyzerResult {
  try {
    const doc: SpdxDocument = JSON.parse(content);

    const elements = getElements(doc);
    const docType = getType(doc);
    const isDocumentRoot = docType && typeIncludes(docType, 'SpdxDocument');
    let specVersion: string | undefined;

    if (isDocumentRoot) {
      specVersion = resolveSpecVersion(doc, elements);
    } else if (elements.length > 0) {
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

    // Duplicates are not deduplicated here — downstream consumers (normalizeResult / mergeResults) handle it.
    const packages: Array<{ purl: string; evidence: string[] }> = [];
    const spdxIdToPurl = new Map<string, string>();
    const spdxIdToElement = new Map<string, SpdxElement>();

    for (const el of elements) {
      const elId = getId(el);
      if (elId) {
        spdxIdToElement.set(elId, el);
      }

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

      if (elId) {
        spdxIdToPurl.set(elId, validatedPurl);
      }

      const evidence: string[] = [];
      if (filePath) {
        evidence.push(filePath);
      }

      packages.push({ purl: validatedPurl, evidence });
    }

    const scopedDeps: ScopedDep[] = [];
    const relationshipMap = new Map<string, Set<string>>();

    const dependencyRelationshipTypes = new Set(['dependsOn', 'hasOptionalDependency', 'hasProvidedDependency']);

    for (const el of elements) {
      const elType = getType(el);
      if (!typeIncludes(elType, 'Relationship') && !typeIncludes(elType, 'LifecycleScopedRelationship')) continue;
      if (!el.relationshipType || !dependencyRelationshipTypes.has(el.relationshipType)) continue;

      const fromId = el.from;
      if (!fromId) continue;
      const fromPurl = spdxIdToPurl.get(fromId);
      if (!fromPurl) continue;

      const toIds = el.to;
      if (!toIds || toIds.length === 0) continue;

      // Only LifecycleScopedRelationship carries a scope; plain Relationship does not.
      // Fall back to relationship type name for hasOptionalDependency / hasProvidedDependency.
      let effectiveScope: string | undefined;
      if (el.scope) {
        effectiveScope = el.scope;
      } else if (el.relationshipType === 'hasOptionalDependency') {
        effectiveScope = 'optional';
      } else if (el.relationshipType === 'hasProvidedDependency') {
        effectiveScope = 'provided';
      }

      for (const toId of toIds) {
        const toPurl = spdxIdToPurl.get(toId);
        if (!toPurl) continue;

        const existing = relationshipMap.get(fromPurl);
        if (existing) {
          existing.add(toPurl);
        } else {
          relationshipMap.set(fromPurl, new Set([toPurl]));
        }

        if (effectiveScope) {
          scopedDeps.push({ fromPurl, toPurl, scope: effectiveScope });
        }
      }
    }

    const rootElementIds = [...getRootElements(doc)];
    if (rootElementIds.length === 0) {
      for (const el of elements) {
        if (typeIncludes(getType(el), 'SpdxDocument')) {
          const docEl = el as unknown as SpdxDocument;
          rootElementIds.push(...getRootElements(docEl));
          break;
        }
      }
    }

    // Follow through Bom/Sbom/Bundle elements to resolve their rootElement entries
    resolveNonPackageRoots(rootElementIds, spdxIdToPurl, spdxIdToElement);

    const subprojects: Subproject[] = [];

    for (const rootId of rootElementIds) {
      const rootPurl = spdxIdToPurl.get(rootId);
      if (!rootPurl) continue;

      const scopeMap = new Map<string, string[]>();

      for (const dep of scopedDeps) {
        if (dep.fromPurl !== rootPurl) continue;
        const existing = scopeMap.get(dep.scope);
        if (existing) {
          existing.push(dep.toPurl);
        } else {
          scopeMap.set(dep.scope, [dep.toPurl]);
        }
      }

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

/**
 * When rootElementIds contains non-Package entries (e.g. Bom/Sbom/Bundle),
 * follow through their rootElement to find the actual packages.
 * Package rootElements are kept as-is (direct dependencies).
 * Non-Package rootElements with their own rootElement are followed recursively.
 */
function resolveNonPackageRoots(
  rootElementIds: string[],
  spdxIdToPurl: Map<string, string>,
  spdxIdToElement: Map<string, SpdxElement>,
): void {
  const resolved: string[] = [];
  const visited = new Set<string>();

  function resolve(ids: string[]) {
    for (const id of ids) {
      if (visited.has(id)) continue;
      visited.add(id);

      if (spdxIdToPurl.has(id)) {
        // It's a Package — keep it as a root element
        resolved.push(id);
        continue;
      }

      // Non-Package element — follow through its rootElement if it has one
      const el = spdxIdToElement.get(id);
      if (el?.rootElement && el.rootElement.length > 0) {
        resolve(el.rootElement);
      }
    }
  }

  resolve(rootElementIds);

  rootElementIds.length = 0;
  rootElementIds.push(...resolved);
}

function extractPurl(el: SpdxElement): string | undefined {
  if (el.packageUrl) {
    return el.packageUrl;
  }
  if (el.software_packageUrl) {
    return el.software_packageUrl;
  }

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
    const infoElement = elements.find((el) => getId(el) === creationInfo);
    if (infoElement?.creationInfo && typeof infoElement.creationInfo !== 'string') {
      return infoElement.creationInfo.specVersion;
    }
    // CreationInfo elements in SPDX 3.0 have specVersion as a direct property
    if (infoElement && typeIncludes(getType(infoElement), 'CreationInfo')) {
      return (infoElement as Record<string, unknown>).specVersion as string | undefined;
    }
    return undefined;
  }

  return creationInfo.specVersion;
}
