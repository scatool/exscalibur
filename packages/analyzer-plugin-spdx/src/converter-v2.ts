import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PackageURL } from "packageurl-js";
import { parse as parseYaml } from "yaml";
import {
  createDependencyGraph,
  createEmptyResultV2,
  normalizeResultV2,
  type AnalyzerResultV2,
  type Completeness,
  type DependencyEdge,
  type DependencyRoot,
  type DependencyView,
  type ExternalReference,
  type JsonValue,
  type PackageV2,
} from "@scatool/analyzer-core";

type RecordValue = Record<string, JsonValue>;
const kinds = ["dependsOn", "hasOptionalDependency", "hasProvidedDependency"];
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Native SPDX 3 compact JSON/JSON-LD and YAML; assertions retain document-scoped identity. */
export function extractSpdxV2(
  content: string,
  options: { codebase: string; evidenceFile: string },
): AnalyzerResultV2 {
  const document = record(parseYaml(content));
  const elements = array(document.element ?? document["@graph"]).map(record);
  const documents = [document, ...elements].filter(
    (element) => term(element.type ?? element["@type"]) === "SpdxDocument",
  );
  if (documents.length !== 1) throw new Error("Expected one SPDX 3 document element");
  const doc = documents[0]!;
  const byId = new Map<string, RecordValue>();
  for (const element of elements) {
    const id = identifier(element);
    if (id === undefined) continue;
    if (byId.has(id) && !isDeepStrictEqual(byId.get(id), element))
      throw new Error(`Conflicting SPDX element ID: ${id}`);
    byId.set(id, element);
  }
  const creationInfo =
    typeof doc.creationInfo === "string" ? byId.get(doc.creationInfo) : doc.creationInfo;
  const info = record(creationInfo ?? {});
  const specVersion = info.specVersion ?? record(info.creationInfo ?? {}).specVersion;
  if (
    typeof specVersion !== "string" ||
    !semver.test(specVersion) ||
    specVersion.split(".")[0] !== "3"
  )
    throw new Error(
      `Unsupported or invalid SPDX version: ${JSON.stringify(specVersion) ?? "undefined"}`,
    );
  const result = createEmptyResultV2(options.codebase);
  const evidence = [options.evidenceFile];
  const nodes = new Map<string, DependencyView>();
  const catalog = new Map<string, PackageV2>();
  const edges: DependencyEdge[] = [];
  const roots: DependencyRoot[] = [];
  const issue = (code: string, message: string) =>
    result.issues.push({ code, message, severity: "WARNING", file: options.evidenceFile });
  const register = (
    nativeId: string,
    element: RecordValue,
    missing = false,
    anonymous = false,
  ): string => {
    const id = anonymous ? `anonymous:${nativeId}` : `spdxId:${JSON.stringify(nativeId)}`;
    if (nodes.has(id)) return id;
    const candidates = [
      element.packageUrl,
      element.software_packageUrl,
      ...array(element.externalIdentifier).flatMap((value) => {
        const identifier = typeof value === "string" ? byId.get(value) : record(value);
        if (!identifier) {
          issue(
            "spdx.missing_identifier",
            `External identifier '${JSON.stringify(value)}' is not reported for '${nativeId}'`,
          );
          return [];
        }
        return term(identifier.externalIdentifierType) === "packageUrl"
          ? [identifier.identifier]
          : [];
      }),
    ].filter((value): value is string => typeof value === "string");
    const purls = new Set<string>();
    for (const value of candidates) {
      try {
        purls.add(PackageURL.fromString(value).toString());
      } catch {
        issue(
          "spdx.invalid_purl",
          `Invalid PURL for '${nativeId}'; retaining the element using another valid identity or a generic PURL`,
        );
      }
    }
    if (purls.size > 1) throw new Error(`Conflicting SPDX package PURLs for '${nativeId}'`);
    const version = element.packageVersion ?? element.software_packageVersion;
    const purl =
      [...purls][0] ??
      new PackageURL(
        "generic",
        "excalibur-spdx",
        `element-${createHash("sha256")
          .update(JSON.stringify([options.codebase, options.evidenceFile, id]))
          .digest("hex")}`,
        typeof version === "string" && version ? version : null,
        null,
        null,
      ).toString();
    const artifacts = [];
    const location = element.downloadLocation ?? element.software_downloadLocation;
    if (typeof location === "string" && location !== "NOASSERTION" && location !== "NONE")
      artifacts.push({ location, evidence });
    const externalReferences: ExternalReference[] = [];
    for (const value of array(element.externalRef ?? element.core_externalRef)) {
      const ref = typeof value === "string" ? byId.get(value) : record(value);
      if (!ref) continue;
      const type = term(ref.externalRefType ?? ref.core_externalRefType);
      if (type !== "vcs" && type !== "sourceArtifact") continue;
      const locator = ref.locator ?? ref.core_locator;
      for (const value of typeof locator === "string" ? [locator] : strings(locator))
        externalReferences.push({ type, locator: value });
    }
    const pkg = catalog.get(purl) ?? {
      purl,
      evidence,
      ...(purls.size === 0 && { synthesizedPurl: true }),
    };
    if (artifacts.length > 0) pkg.artifacts = [...(pkg.artifacts ?? []), ...artifacts];
    if (externalReferences.length > 0)
      pkg.externalReferences = [...(pkg.externalReferences ?? []), ...externalReferences];
    catalog.set(purl, pkg);
    nodes.set(id, {
      id,
      purl,
      ...(!anonymous && { locator: nativeId }),
      dependencyCompleteness: "unknown",
      evidence,
      attributes: { "spdx:element": element, ...(missing && { "spdx:elementMissing": true }) },
    });
    return id;
  };
  for (const [index, element] of elements.entries()) {
    if (term(element.type ?? element["@type"]) === "Package")
      register(
        identifier(element) ?? String(index),
        element,
        false,
        identifier(element) === undefined,
      );
  }
  const ensure = (id: string): string => {
    const existing = `spdxId:${JSON.stringify(id)}`;
    if (nodes.has(existing)) return existing;
    const element = byId.get(id);
    if (!element)
      issue(
        "spdx.missing_element",
        `Referenced SPDX element '${id}' is not reported; preserving its reference with unknown metadata and adjacency`,
      );
    return register(id, element ?? {}, !element);
  };
  type Claim = { completeness: Completeness; targets: string[] };
  const claims = new Map<string, Map<string, Map<string, Claim[]>>>();
  const nativeScopes = new Map<string, Set<string>>();
  for (const relationship of elements) {
    if (
      !["Relationship", "LifecycleScopedRelationship"].includes(
        term(relationship.type ?? relationship["@type"]) ?? "",
      )
    )
      continue;
    const kind = term(relationship.relationshipType);
    if (kind === undefined || !kinds.includes(kind)) continue;
    if (typeof relationship.from !== "string")
      throw new Error("SPDX dependency relationship is missing its source");
    const from = ensure(relationship.from);
    const targets = strings(relationship.to);
    if (targets.length === 0)
      throw new Error("An empty SPDX relationship must explicitly use NoneElement");
    const none = targets.filter((id) => special(id) === "NoneElement");
    if (none.length > 0 && targets.length !== 1)
      throw new Error("SPDX NoneElement cannot be combined with other relationship targets");
    const noAssertion = targets.some((id) => special(id) === "NoAssertionElement");
    const scope =
      typeof relationship.scope === "string" ? term(relationship.scope)! : "dependencies";
    const scopes = nativeScopes.get(from) ?? new Set<string>();
    scopes.add(scope);
    nativeScopes.set(from, scopes);
    const byScope = claims.get(from) ?? new Map<string, Map<string, Claim[]>>();
    const byKind = byScope.get(scope) ?? new Map<string, Claim[]>();
    const predicates = Object.fromEntries(
      ["scope", "startTime", "endTime"].flatMap((key) =>
        relationship[key] === undefined ? [] : [[key, relationship[key]!]],
      ),
    );
    // Conditional absence is not a globally known leaf. Scalar completeness remains unknown;
    // the original scoped/time-bounded claim stays available in the native assertion metadata.
    const completeness =
      noAssertion || Object.keys(predicates).length > 0
        ? "unknown"
        : none.length > 0 || term(relationship.completeness) === "complete"
          ? "complete"
          : term(relationship.completeness) === "incomplete"
            ? "partial"
            : "unknown";
    byKind.set(kind, [...(byKind.get(kind) ?? []), { completeness, targets }]);
    byScope.set(scope, byKind);
    claims.set(from, byScope);
    const semantics = {
      from,
      relation: "depends-on" as const,
      kind,
      evidence,
      ...(kind === "hasOptionalDependency" && { optional: true }),
      attributes: { "spdx:relationship": relationship, "spdx:lifecycleScope": scope },
    };
    for (const target of targets) {
      if (special(target) === "NoneElement") continue;
      if (special(target) === "NoAssertionElement") continue;
      edges.push({
        ...semantics,
        status: "resolved",
        to: ensure(target),
        ...(Object.keys(predicates).length > 0
          ? {
              selection: "conditional" as const,
              condition: { language: "spdx:lifecycle/v1", expression: predicates },
            }
          : { selection: "selected" as const }),
      });
    }
  }
  const completenessFor = (from: string, scope: string): Completeness => {
    const byKind = claims.get(from)?.get(scope);
    const values = kinds.map((kind) => {
      const observed = byKind?.get(kind) ?? [];
      if (observed.length === 0 || observed.some((claim) => claim.completeness === "unknown"))
        return "unknown";
      const signatures = observed
        .filter((claim) => claim.completeness === "complete")
        .map((claim) =>
          JSON.stringify(
            [...new Set(claim.targets.map((target) => special(target) ?? target))].sort(),
          ),
        );
      if (new Set(signatures).size > 1) {
        issue(
          "spdx.conflicting_completeness",
          `Conflicting complete '${kind}' target sets are retained for '${nodes.get(from)!.locator}'`,
        );
        return "partial";
      }
      return observed.some((claim) => claim.completeness === "partial") ? "partial" : "complete";
    });
    return values.includes("unknown")
      ? "unknown"
      : values.includes("partial")
        ? "partial"
        : "complete";
  };
  for (const node of nodes.values()) {
    if (nativeScopes.get(node.id)?.size === 1 && nativeScopes.get(node.id)?.has("dependencies"))
      node.dependencyCompleteness = completenessFor(node.id, "dependencies");
  }
  const subjectIds = new Set<string>();
  const visited = new Set<string>();
  let rootExpansionComplete = true;
  const visit = (id: string, ancestors = new Set<string>()) => {
    if (ancestors.has(id)) {
      rootExpansionComplete = false;
      issue(
        "spdx.root_expansion_incomplete",
        `Cyclic analyzed-subject collection '${id}' leaves root coverage incomplete`,
      );
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    const element = byId.get(id);
    if (
      element &&
      ["Bom", "Sbom", "Bundle", "SpdxDocument"].includes(
        term(element.type ?? element["@type"]) ?? "",
      )
    ) {
      const children = strings(element.rootElement);
      if (children.length === 0) {
        rootExpansionComplete = false;
        issue(
          "spdx.root_expansion_incomplete",
          `Analyzed-subject collection '${id}' has no reported roots; ordinary members are not assumed to be subjects`,
        );
      }
      for (const child of children) visit(child, new Set([...ancestors, id]));
    } else {
      if (!element) rootExpansionComplete = false;
      subjectIds.add(ensure(id));
    }
  };
  for (const id of strings(doc.rootElement)) visit(id);
  for (const id of subjectIds) {
    const subject = nodes.get(id)!;
    const project = {
      purl: subject.purl,
      definitionFile: `${options.evidenceFile}#spdxId=${encodeURIComponent(subject.locator!)}`,
    };
    subject.project = project;
    result.subprojects.push({
      ...project,
      evidence,
      ...(catalog.get(subject.purl)!.synthesizedPurl && { synthesizedPurl: true }),
      attributes: { "spdx:subject": true, "spdx:reference": subject.locator! },
    });
    for (const scope of nativeScopes.get(id) ?? ["dependencies"]) {
      const rootId = `scope:${JSON.stringify([subject.locator, scope])}`;
      nodes.set(rootId, {
        id: rootId,
        purl: subject.purl,
        project,
        dependencyCompleteness: completenessFor(id, scope),
        evidence,
      });
      roots.push({ id: rootId, project, scope, node: rootId });
      edges.push(
        ...edges
          .filter((edge) => edge.from === id && edge.attributes?.["spdx:lifecycleScope"] === scope)
          .map((edge) => ({ ...edge, from: rootId })),
      );
    }
  }
  const { element: _element, "@graph": _graph, ...documentFields } = document;
  result.packages = [...catalog.values()];
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "spdx", files: evidence },
      interpretation: "unknown",
      rootCompleteness: !rootExpansionComplete
        ? "partial"
        : subjectIds.size === 0
          ? "unknown"
          : "complete",
      roots,
      nodes: [...nodes.values()],
      edges,
      attributes: {
        "spdx:document": documentFields,
        "spdx:assertions": elements.filter(
          (element) => term(element.type ?? element["@type"]) !== "Package",
        ),
      },
    }),
  );
  return normalizeResultV2(result);
}

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an SPDX record");
  return value as RecordValue;
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Expected an SPDX array");
  return value;
}
function strings(value: JsonValue | undefined): string[] {
  const values = array(value);
  if (!values.every((item) => typeof item === "string"))
    throw new Error("Expected SPDX reference strings");
  return values;
}
function identifier(value: RecordValue): string | undefined {
  const id = value.spdxId ?? value["@id"];
  return typeof id === "string" ? id : undefined;
}
function term(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value.split(/[/:_]/).at(-1) : undefined;
}
function special(value: string): string | undefined {
  return /^(?:https:\/\/spdx\.org\/rdf\/3\.[^/]+\/terms\/Core\/|core_)?(?:NoneElement|NoAssertionElement)$/.test(
    value,
  )
    ? term(value)
    : undefined;
}
