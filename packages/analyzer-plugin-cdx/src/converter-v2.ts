import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResultV2,
  normalizeResultV2,
  type AnalyzerResultV2,
  type Artifact,
  type DependencyEdge,
  type DependencyView,
  type ExternalReference,
  type JsonValue,
  type PackageV2,
} from "@scatool/analyzer-core";

type RecordValue = Record<string, JsonValue>;

/** Import document-scoped references without merging adjacency by package coordinate. */
export function extractCycloneDXV2(
  content: string,
  options: { codebase: string; evidenceFile: string },
): AnalyzerResultV2 {
  const bom = record(JSON.parse(content.replace(/^\uFEFF/, "")));
  if (bom.bomFormat !== "CycloneDX") throw new Error("Not a CycloneDX BOM");
  if (typeof bom.specVersion !== "string" || !/^1\.[2-7]$/.test(bom.specVersion))
    throw new Error(
      `Unsupported CycloneDX version: ${JSON.stringify(bom.specVersion) ?? "undefined"}`,
    );
  const result = createEmptyResultV2(options.codebase);
  const evidence = [options.evidenceFile];
  const nodes = new Map<string, DependencyView>();
  const references = new Map<string, string>();
  const native = new Map<string, RecordValue>();
  const catalog = new Map<string, PackageV2>();
  const edges: DependencyEdge[] = [];
  const issue = (code: string, message: string) =>
    result.issues.push({ code, message, severity: "WARNING", file: options.evidenceFile });
  const fallback = (id: string, component: RecordValue) =>
    new PackageURL(
      "generic",
      "excalibur-cyclonedx",
      `component-${createHash("sha256")
        .update(JSON.stringify([options.codebase, options.evidenceFile, id]))
        .digest("hex")}`,
      typeof component.version === "string" && component.version ? component.version : null,
      null,
      null,
    ).toString();

  const register = (
    component: RecordValue,
    path: string,
    kind: "component" | "service",
  ): string => {
    const ref = typeof component["bom-ref"] === "string" ? component["bom-ref"] : undefined;
    const id = ref === undefined ? `anonymous:${path}` : `bom-ref:${JSON.stringify(ref)}`;
    const previous = native.get(id);
    if (previous) {
      if (!isDeepStrictEqual(previous, component))
        throw new Error(`Conflicting CycloneDX entity reference: ${ref}`);
      return id;
    }
    native.set(id, component);
    if (ref !== undefined) references.set(ref, id);
    let purl: string | undefined;
    if (typeof component.purl === "string") {
      try {
        purl = PackageURL.fromString(component.purl).toString();
      } catch {
        issue(
          "cyclonedx.invalid_purl",
          `Invalid PURL for ${ref ?? path}; preserving the entity with a generic PURL`,
        );
      }
    }
    const synthesized = purl === undefined;
    purl ??= fallback(id, component);
    const occurrences = record(component.evidence ?? {}).occurrences;
    const entityEvidence = [...evidence];
    for (const value of array(occurrences)) {
      const occurrence = record(value);
      if (typeof occurrence.location === "string")
        entityEvidence.push(
          `${occurrence.location}${typeof occurrence.line === "number" ? `#${occurrence.line}` : ""}`,
        );
    }
    const hashes: Record<string, string> = {};
    for (const value of array(component.hashes)) {
      const hash = record(value);
      if (typeof hash.alg !== "string" || typeof hash.content !== "string")
        throw new Error("Invalid CycloneDX component hash");
      if (Object.hasOwn(hashes, hash.alg) && hashes[hash.alg] !== hash.content)
        throw new Error(`Conflicting CycloneDX ${hash.alg} hashes for ${ref ?? path}`);
      Object.defineProperty(hashes, hash.alg, { value: hash.content, enumerable: true });
    }
    const selectedArtifacts: Artifact[] =
      Object.keys(hashes).length > 0 ? [{ hashes, evidence }] : [];
    const artifacts = [...selectedArtifacts];
    const externalReferences: ExternalReference[] = [];
    for (const value of array(component.externalReferences)) {
      const reference = record(value);
      if (typeof reference.url !== "string") continue;
      if (reference.type === "distribution") artifacts.push({ location: reference.url, evidence });
      if (reference.type === "vcs" || reference.type === "source-distribution")
        externalReferences.push({
          type: reference.type === "vcs" ? "vcs" : "sourceArtifact",
          locator: reference.url,
        });
    }
    const existing = catalog.get(purl) ?? {
      purl,
      evidence: [],
      ...(synthesized && { synthesizedPurl: true }),
    };
    existing.evidence.push(...entityEvidence);
    if (artifacts.length > 0) existing.artifacts = [...(existing.artifacts ?? []), ...artifacts];
    if (externalReferences.length > 0)
      existing.externalReferences = [...(existing.externalReferences ?? []), ...externalReferences];
    catalog.set(purl, existing);
    const { components, services, ...metadata } = component;
    const node: DependencyView = {
      id,
      purl,
      ...(ref !== undefined && { locator: ref }),
      dependencyCompleteness: "unknown",
      evidence: entityEvidence,
      ...(selectedArtifacts.length > 0 && { artifacts: selectedArtifacts }),
      attributes: { "cyclonedx:entityKind": kind, "cyclonedx:entity": metadata },
    };
    nodes.set(id, node);
    const children = [
      ...array(components).map((value, index) =>
        register(record(value), `${path}/components/${index}`, "component"),
      ),
      ...array(services).map((value, index) =>
        register(record(value), `${path}/services/${index}`, "service"),
      ),
    ];
    if (children.length > 0) node.attributes!["cyclonedx:children"] = children;
    return id;
  };
  const metadata = record(bom.metadata ?? {});
  const subject =
    metadata.component === undefined
      ? undefined
      : register(record(metadata.component), "metadata/component", "component");
  for (const [index, value] of array(bom.components).entries())
    register(record(value), `components/${index}`, "component");
  for (const [index, value] of array(bom.services).entries())
    register(record(value), `services/${index}`, "service");
  const ensureReference = (ref: string): string => {
    const existing = references.get(ref);
    if (existing) return existing;
    const id = register({ "bom-ref": ref }, `unreported/${ref}`, "component");
    nodes.get(id)!.attributes!["cyclonedx:entityMissing"] = true;
    if (ref.startsWith("urn:cdx:")) {
      nodes.get(id)!.attributes!["cyclonedx:externalReference"] = ref;
      result.issues.push({
        code: "cyclonedx.external_reference",
        severity: "HINT",
        file: options.evidenceFile,
        message: `External BOM-Link '${ref}' is retained without assuming its entity metadata or dependencies`,
      });
    } else
      issue(
        "cyclonedx.missing_entity",
        `Dependency reference '${ref}' has no reported component or service; preserving the graph reference with a generic PURL`,
      );
    return id;
  };
  const dependencyRecords = new Map<string, string>();
  for (const value of array(bom.dependencies)) {
    const dependency = record(value);
    if (typeof dependency.ref !== "string")
      throw new Error("CycloneDX dependency is missing its reference");
    const from = ensureReference(dependency.ref);
    const targets = stringArray(dependency.dependsOn);
    const signature = JSON.stringify([...new Set(targets)].sort());
    if (dependencyRecords.has(from)) {
      if (dependencyRecords.get(from) !== signature)
        throw new Error(`Conflicting CycloneDX dependency lists for '${dependency.ref}'`);
    } else {
      dependencyRecords.set(from, signature);
      nodes.get(from)!.dependencyCompleteness = "complete";
      for (const ref of targets) {
        const to = ensureReference(ref);
        const scope = native.get(to)?.scope;
        edges.push({
          from,
          to,
          relation: "depends-on",
          kind: "dependsOn",
          status: "resolved",
          selection: "selected",
          evidence,
          ...(typeof scope === "string" && { attributes: { "cyclonedx:scope": scope } }),
        });
      }
    }
    // 'provides' and component containment do not introduce dependency reachability.
    const records = nodes.get(from)!.attributes!["cyclonedx:dependencyRecords"] ?? [];
    nodes.get(from)!.attributes!["cyclonedx:dependencyRecords"] = [...array(records), dependency];
  }
  const compositionCompleteness = new Map<string, "partial" | "unknown">();
  const completeClaims = new Set<string>();
  const incompleteClaims = new Set<string>();
  for (const value of array(bom.compositions)) {
    const composition = record(value);
    for (const ref of stringArray(composition.dependencies)) {
      const id = ensureReference(ref);
      if (composition.aggregate === "complete") completeClaims.add(id);
      if (
        typeof composition.aggregate === "string" &&
        composition.aggregate.startsWith("incomplete")
      )
        incompleteClaims.add(id);
      if (composition.aggregate === "unknown" || composition.aggregate === "not_specified")
        compositionCompleteness.set(id, "unknown");
      else if (
        typeof composition.aggregate === "string" &&
        composition.aggregate.startsWith("incomplete") &&
        compositionCompleteness.get(id) !== "unknown"
      )
        compositionCompleteness.set(id, "partial");
      // 'complete' describes the aggregate observation; it does not invent outgoing dependency
      // records for an entity omitted from the explicit graph. Preserve it in document metadata.
    }
  }
  for (const [id, completeness] of compositionCompleteness)
    nodes.get(id)!.dependencyCompleteness = completeness;
  for (const id of completeClaims) {
    if (incompleteClaims.has(id))
      issue(
        "cyclonedx.conflicting_completeness",
        `Conflicting complete/incomplete composition claims for '${nodes.get(id)!.locator ?? id}' are retained conservatively`,
      );
    if (!dependencyRecords.has(id))
      issue(
        "cyclonedx.missing_dependency_record",
        `A complete composition names '${nodes.get(id)!.locator ?? id}' but its dependency record is absent; completeness remains unknown`,
      );
  }
  const roots = [];
  if (subject !== undefined) {
    const node = nodes.get(subject)!;
    const project = { purl: node.purl, definitionFile: options.evidenceFile };
    node.project = project;
    result.subprojects.push({
      ...project,
      evidence,
      ...(catalog.get(node.purl)!.synthesizedPurl && { synthesizedPurl: true }),
      attributes: { "cyclonedx:subject": true, "cyclonedx:reference": node.locator ?? subject },
    });
    roots.push({ id: "subject/dependencies", project, scope: "dependencies", node: subject });
  }
  const {
    components: _components,
    services: _services,
    dependencies: _dependencies,
    metadata: _metadata,
    ...document
  } = bom;
  const { component: _component, ...documentMetadata } = metadata;
  result.packages = [...catalog.values()];
  result.graphs.push(
    createDependencyGraph({
      source: {
        extractor: "cyclonedx",
        files: evidence,
        ...(typeof bom.serialNumber === "string" && { key: bom.serialNumber }),
      },
      interpretation: "unknown",
      rootCompleteness: subject === undefined ? "unknown" : "complete",
      roots,
      nodes: [...nodes.values()],
      edges,
      attributes: { "cyclonedx:document": document, "cyclonedx:metadata": documentMetadata },
    }),
  );
  return normalizeResultV2(result);
}

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a CycloneDX record");
  return value as RecordValue;
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Expected a CycloneDX array");
  return value;
}
function stringArray(value: JsonValue | undefined): string[] {
  const values = array(value);
  if (!values.every((item) => typeof item === "string"))
    throw new Error("Expected CycloneDX reference strings");
  return values;
}
