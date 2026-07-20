import {
  type AnalyzerResult,
  type Extractor,
  type Subproject,
  type DependencyScope,
  filesExtractor,
  readTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { parse as parseYaml } from "yaml";
import { optionSchema, type SpdxOptions } from "./options.ts";

export const extractor: Extractor<SpdxOptions> = filesExtractor<SpdxOptions>({
  name: "spdx",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: SpdxOptions) {
    await scanAndMarkFiles(this, codebase, "**/*.spdx.{json,jsonld,yaml,yml}", options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await readTextFile(file);
    return extractSpdx(content, file);
  },
});

type SpdxCreationInfo = {
  specVersion?: unknown;
};

type SpdxExternalIdentifier = {
  externalIdentifierType?: string;
  identifier?: string;
};

type SpdxElement = {
  type?: string;
  spdxId?: string;
  "@type"?: string;
  "@id"?: string;
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
  specVersion?: unknown;
};

type SpdxDocument = SpdxElement & {
  element?: SpdxElement[];
  "@graph"?: SpdxElement[];
  "@context"?: unknown;
};

const DEPENDENCY_RELATIONSHIP_TYPES = new Set([
  "dependsOn",
  "hasOptionalDependency",
  "hasProvidedDependency",
]);

const DEFAULT_SCOPE = "dependencies";

// SPDX specVersion values use Semantic Versioning 2.0.0. Keep the validation
// local so version detection does not require another runtime dependency.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function getType(el: { type?: string; "@type"?: string }): string | undefined {
  return el.type ?? el["@type"];
}

function getId(el: { spdxId?: string; "@id"?: string }): string | undefined {
  return el.spdxId ?? el["@id"];
}

function getElements(doc: SpdxDocument): SpdxElement[] {
  return doc.element ?? doc["@graph"] ?? [];
}

function getRootElements(doc: SpdxDocument | SpdxElement): string[] {
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
    const doc = parseYaml(content) as SpdxDocument;

    const elements = getElements(doc);
    const docType = getType(doc);
    const isDocumentRoot = typeIncludes(docType, "SpdxDocument");
    let specVersion: unknown;

    if (isDocumentRoot) {
      specVersion = resolveSpecVersion(doc, elements);
    } else if (elements.length > 0) {
      const docElement = elements.find((el) => typeIncludes(getType(el), "SpdxDocument"));
      if (docElement) {
        specVersion = resolveSpecVersion(docElement, elements);
      }
    }

    if (specVersion === undefined) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                code: "spdx.not_spdx_document",
                message: `Not an SPDX 3.x document (could not determine specVersion)`,
                severity: "WARNING",
                file: filePath,
              },
            ]
          : [],
      };
    }

    const versionMatch =
      typeof specVersion === "string" ? SEMVER_PATTERN.exec(specVersion) : undefined;

    if (typeof specVersion !== "string" || !versionMatch) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                code: "spdx.invalid_version",
                message: `Invalid SPDX version: ${formatSpecVersion(specVersion)} (expected a valid SemVer in the 3.x range)`,
                severity: "ERROR",
                file: filePath,
              },
            ]
          : [],
      };
    }

    if (versionMatch[1] !== "3") {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                code: "spdx.unsupported_version",
                message: `Unsupported SPDX version: ${specVersion} (expected 3.x)`,
                severity: "ERROR",
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
      if (!typeIncludes(elType, "Package")) continue;

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

    const scopedDepsByFrom = new Map<string, ScopedDep[]>();
    const relationshipMap = new Map<string, Set<string>>();

    for (const el of elements) {
      const elType = getType(el);
      if (
        !typeIncludes(elType, "Relationship") &&
        !typeIncludes(elType, "LifecycleScopedRelationship")
      )
        continue;
      if (!el.relationshipType || !DEPENDENCY_RELATIONSHIP_TYPES.has(el.relationshipType)) continue;

      const fromId = el.from;
      if (!fromId) continue;
      const fromPurl = spdxIdToPurl.get(fromId);
      if (!fromPurl) continue;

      const toIds = el.to;
      if (!toIds || toIds.length === 0) continue;

      // SPDX 3.0 splits dependency metadata across two orthogonal axes:
      //   - relationshipType ∈ {dependsOn, hasOptionalDependency, hasProvidedDependency}  (kind)
      //   - scope ∈ LifecycleScopeType {design, development, build, test, runtime, ...}  (phase)
      // Our DependencyScope model only carries one label, so when both are present (e.g. a
      // runtime-only optional dep) we keep the lifecycle scope and drop the kind qualifier.
      // For a pure hasOptional/hasProvided relationship without a lifecycle scope, we fall
      // back to the kind name. Round-trips from npm's optionalDependencies/peerDependencies
      // are therefore lossy when re-serialized through SPDX with a lifecycle scope.
      let effectiveScope: string | undefined;
      if (el.scope) {
        effectiveScope = el.scope;
      } else if (el.relationshipType === "hasOptionalDependency") {
        effectiveScope = "optional";
      } else if (el.relationshipType === "hasProvidedDependency") {
        effectiveScope = "provided";
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
          const dep: ScopedDep = { fromPurl, toPurl, scope: effectiveScope };
          const list = scopedDepsByFrom.get(fromPurl);
          if (list) {
            list.push(dep);
          } else {
            scopedDepsByFrom.set(fromPurl, [dep]);
          }
        }
      }
    }

    let rootElementIds = [...getRootElements(doc)];
    if (rootElementIds.length === 0) {
      const docElement = elements.find((el) => typeIncludes(getType(el), "SpdxDocument"));
      if (docElement) {
        rootElementIds.push(...getRootElements(docElement));
      }
    }

    // Follow through Bom/Sbom/Bundle elements to resolve their rootElement entries
    rootElementIds = resolveNonPackageRoots(rootElementIds, spdxIdToPurl, spdxIdToElement);

    const subprojects: Subproject[] = [];

    for (const rootId of rootElementIds) {
      const rootPurl = spdxIdToPurl.get(rootId);
      if (!rootPurl) continue;

      const scopeMap = new Map<string, string[]>();
      const scopedToPurls = new Set<string>();

      const rootScopedDeps = scopedDepsByFrom.get(rootPurl);
      if (rootScopedDeps) {
        for (const dep of rootScopedDeps) {
          scopedToPurls.add(dep.toPurl);
          const existing = scopeMap.get(dep.scope);
          if (existing) {
            existing.push(dep.toPurl);
          } else {
            scopeMap.set(dep.scope, [dep.toPurl]);
          }
        }
      }

      const unscopedDeps = relationshipMap.get(rootPurl);
      if (unscopedDeps) {
        const unscopedPurls: string[] = [];
        for (const toPurl of unscopedDeps) {
          if (!scopedToPurls.has(toPurl)) {
            unscopedPurls.push(toPurl);
          }
        }
        if (unscopedPurls.length > 0) {
          const existing = scopeMap.get(DEFAULT_SCOPE);
          if (existing) {
            existing.push(...unscopedPurls);
          } else {
            scopeMap.set(DEFAULT_SCOPE, unscopedPurls);
          }
        }
      }

      const scopes: DependencyScope[] = [];
      for (const [scope, pkgs] of scopeMap) {
        scopes.push({ scope, packages: pkgs });
      }

      subprojects.push({
        purl: rootPurl,
        definitionFile: filePath ?? "",
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
              code: "spdx.parse_failed",
              message: `Failed to parse SPDX document: ${error instanceof Error ? error.message : String(error)}`,
              severity: "ERROR",
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
 */
function resolveNonPackageRoots(
  rootElementIds: string[],
  spdxIdToPurl: Map<string, string>,
  spdxIdToElement: Map<string, SpdxElement>,
): string[] {
  const resolved: string[] = [];
  const visited = new Set<string>();

  function resolve(ids: string[]) {
    for (const id of ids) {
      if (visited.has(id)) continue;
      visited.add(id);

      if (spdxIdToPurl.has(id)) {
        resolved.push(id);
        continue;
      }

      const el = spdxIdToElement.get(id);
      if (el?.rootElement && el.rootElement.length > 0) {
        resolve(el.rootElement);
      }
    }
  }

  resolve(rootElementIds);
  return resolved;
}

function formatSpecVersion(specVersion: unknown): string {
  if (specVersion === null) return "null";
  if (typeof specVersion === "string") return specVersion;
  if (
    typeof specVersion === "number" ||
    typeof specVersion === "boolean" ||
    typeof specVersion === "bigint"
  ) {
    return specVersion.toString();
  }
  return `<${typeof specVersion}>`;
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
        typeIncludes(extId.externalIdentifierType, "packageUrl") &&
        extId.identifier
      ) {
        return extId.identifier;
      }
    }
  }

  return undefined;
}

function resolveSpecVersion(
  docOrElement: SpdxDocument | SpdxElement,
  elements: SpdxElement[],
): unknown {
  const creationInfo = docOrElement.creationInfo;
  if (!creationInfo) return undefined;

  if (typeof creationInfo === "string") {
    const infoElement = elements.find((el) => getId(el) === creationInfo);
    if (!infoElement) return undefined;
    if (infoElement.creationInfo && typeof infoElement.creationInfo !== "string") {
      return infoElement.creationInfo.specVersion;
    }
    if (typeIncludes(getType(infoElement), "CreationInfo")) {
      return infoElement.specVersion;
    }
    return undefined;
  }

  return creationInfo.specVersion;
}
