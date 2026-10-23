import { createHash } from "node:crypto";
import { canonicalJson, compareStrings, sortedStrings, uniqueRecords } from "./json.ts";
import { parseResultV2 } from "./validate.ts";
import type {
  AnalyzerResultV2,
  Artifact,
  DependencyGraph,
  DependencyRequest,
  IdentityObservation,
} from "./types.ts";

function normalizeIdentityObservations(observations: IdentityObservation[]): IdentityObservation[] {
  return uniqueRecords(
    observations.map((observation) => ({
      ...observation,
      source: { ...observation.source, files: sortedStrings(observation.source.files) },
    })),
  );
}

function normalizeArtifacts(artifacts: Artifact[] | undefined): Artifact[] | undefined {
  return (
    artifacts &&
    uniqueRecords(
      artifacts.map((artifact) => ({
        ...artifact,
        evidence: sortedStrings(artifact.evidence),
      })),
    )
  );
}

function normalizeRequest(request: DependencyRequest | undefined): DependencyRequest | undefined {
  if (!request) return request;
  return {
    ...request,
    ...(request.features !== undefined && { features: sortedStrings(request.features) }),
  };
}

/** Clone and sort known set-valued fields without rearranging native JSON arrays. */
export function normalizeDependencyGraph(graph: DependencyGraph): DependencyGraph {
  const copy = structuredClone(graph);
  copy.source.files = sortedStrings(copy.source.files);
  copy.nodes = copy.nodes
    .map((node) => ({
      ...node,
      ...(node.evidence !== undefined && { evidence: sortedStrings(node.evidence) }),
      ...(node.artifacts !== undefined && { artifacts: normalizeArtifacts(node.artifacts) }),
      ...(node.variant !== undefined && {
        variant: {
          ...node.variant,
          ...(node.variant.enabledFeatures !== undefined && {
            enabledFeatures: sortedStrings(node.variant.enabledFeatures),
          }),
        },
      }),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));
  copy.roots = copy.roots
    .map((root) => ({
      ...root,
      ...(root.evidence !== undefined && { evidence: sortedStrings(root.evidence) }),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));
  copy.edges = uniqueRecords(
    copy.edges.map((edge) => ({
      ...edge,
      ...(edge.evidence !== undefined && { evidence: sortedStrings(edge.evidence) }),
      ...(edge.requested !== undefined && { requested: normalizeRequest(edge.requested) }),
    })),
  ) as DependencyGraph["edges"];
  return JSON.parse(canonicalJson(copy)) as DependencyGraph;
}

/**
 * Content-address an observation, not individual dependency nodes. Node IDs remain source-native
 * even for cycles. Include source.key/context when separately identifiable observations must remain
 * distinct. Files should already use the caller's codebase-relative naming convention.
 */
export function createDependencyGraph(input: Omit<DependencyGraph, "id">): DependencyGraph {
  const { id: _, ...observation } = normalizeDependencyGraph({ ...input, id: "" });
  const digest = createHash("sha256").update(canonicalJson(observation)).digest("hex");
  return { id: `${input.source.extractor}:${digest}`, ...observation };
}

export function normalizeResultV2(input: AnalyzerResultV2): AnalyzerResultV2 {
  const result = parseResultV2(input);
  result.packages = result.packages
    .map((pkg) => ({
      ...pkg,
      ...(pkg.identityObservations !== undefined && {
        identityObservations: normalizeIdentityObservations(pkg.identityObservations),
      }),
      evidence: sortedStrings(pkg.evidence),
      ...(pkg.artifacts !== undefined && { artifacts: normalizeArtifacts(pkg.artifacts) }),
      ...(pkg.externalReferences !== undefined && {
        externalReferences: uniqueRecords(pkg.externalReferences),
      }),
    }))
    .sort((a, b) => compareStrings(a.purl, b.purl));
  result.subprojects = result.subprojects
    .map((project) => ({
      ...project,
      ...(project.identityObservations !== undefined && {
        identityObservations: normalizeIdentityObservations(project.identityObservations),
      }),
      ...(project.evidence !== undefined && { evidence: sortedStrings(project.evidence) }),
    }))
    .sort(
      (a, b) =>
        compareStrings(a.purl, b.purl) || compareStrings(a.definitionFile, b.definitionFile),
    );
  result.graphs = result.graphs
    .map(normalizeDependencyGraph)
    .sort((a, b) => compareStrings(a.id, b.id));
  const severity = { ERROR: 0, WARNING: 1, HINT: 2 };
  result.issues = uniqueRecords(result.issues).sort(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      compareStrings(canonicalJson(a), canonicalJson(b)),
  );
  // Keep additive fields, recursively canonicalize object keys, and return independent JSON data.
  return JSON.parse(canonicalJson(result)) as AnalyzerResultV2;
}
