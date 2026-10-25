import { canonicalJson, sortedStrings, uniqueRecords } from "./json.ts";
import { normalizeResult } from "./normalize.ts";
import { projectKey, validateResult } from "./validate.ts";
import type { AnalyzerResult, DependencyGraph, Package, Subproject } from "./types.ts";

export function createEmptyResult(codebase: string): AnalyzerResult {
  if (!codebase) throw new Error("An analyzer result requires its codebase namespace");
  return { formatVersion: 2, codebase, packages: [], subprojects: [], graphs: [], issues: [] };
}

/**
 * Aggregate observations from one codebase. Graphs are never joined by PURL or variant attributes.
 * Equal observation IDs must have equal contents; conflicting IDs fail instead of corrupting topology.
 */
export function mergeResults(
  inputs: readonly AnalyzerResult[],
  options: { codebase?: string } = {},
): AnalyzerResult {
  const codebase = options.codebase ?? inputs[0]?.codebase;
  if (!codebase) throw new Error("Merging no results requires an explicit codebase namespace");

  const packagesByPurl = new Map<string, Package>();
  const projectsByIdentity = new Map<string, Subproject>();
  const graphsById = new Map<string, DependencyGraph>();
  const issues: AnalyzerResult["issues"] = [];
  let mergedMetadata: object = {};

  for (const input of inputs) {
    validateResult(input);
    if (input.codebase !== codebase) {
      throw new Error(
        `Cannot merge codebase '${input.codebase}' into '${codebase}' without explicit reconciliation`,
      );
    }

    const result = normalizeResult(input);
    const {
      packages: _packages,
      subprojects: _subprojects,
      graphs: _graphs,
      issues: _issues,
      ...resultMetadata
    } = result;
    mergedMetadata = mergeCompatible(mergedMetadata, resultMetadata, "result metadata");

    for (const pkg of result.packages) {
      const existing = packagesByPurl.get(pkg.purl);
      packagesByPurl.set(pkg.purl, existing ? mergePackage(existing, pkg) : pkg);
    }

    for (const project of result.subprojects) {
      const key = projectKey(project);
      const existing = projectsByIdentity.get(key);
      projectsByIdentity.set(key, existing ? mergeProject(existing, project) : project);
    }

    // Catalog facts accumulate, but graph adjacency belongs to one independent observation.
    for (const graph of result.graphs) {
      const existing = graphsById.get(graph.id);
      if (existing && canonicalJson(existing) !== canonicalJson(graph)) {
        throw new Error(`Conflicting dependency graph observation ID: ${graph.id}`);
      }
      graphsById.set(graph.id, graph);
    }

    issues.push(...result.issues);
  }

  return normalizeResult({
    ...mergedMetadata,
    formatVersion: 2,
    codebase,
    packages: [...packagesByPurl.values()],
    subprojects: [...projectsByIdentity.values()],
    graphs: [...graphsById.values()],
    issues,
  });
}

function mergePackage(left: Package, right: Package): Package {
  const {
    identityObservations: leftObservations,
    evidence: leftEvidence,
    artifacts: leftArtifacts,
    externalReferences: leftReferences,
    ...leftFacts
  } = left;
  const {
    identityObservations: rightObservations,
    evidence: rightEvidence,
    artifacts: rightArtifacts,
    externalReferences: rightReferences,
    ...rightFacts
  } = right;

  // Known observation sets combine. Preserve absence when neither side observed the field.
  return {
    ...mergeCompatible(leftFacts, rightFacts, `package '${left.purl}'`),
    evidence: sortedStrings([...leftEvidence, ...rightEvidence]),
    ...((leftObservations !== undefined || rightObservations !== undefined) && {
      identityObservations: uniqueRecords([
        ...(leftObservations ?? []),
        ...(rightObservations ?? []),
      ]),
    }),
    ...((leftArtifacts !== undefined || rightArtifacts !== undefined) && {
      artifacts: uniqueRecords([...(leftArtifacts ?? []), ...(rightArtifacts ?? [])]),
    }),
    ...((leftReferences !== undefined || rightReferences !== undefined) && {
      externalReferences: uniqueRecords([...(leftReferences ?? []), ...(rightReferences ?? [])]),
    }),
  };
}

function mergeProject(left: Subproject, right: Subproject): Subproject {
  const { evidence: leftEvidence, identityObservations: leftObservations, ...leftFacts } = left;
  const { evidence: rightEvidence, identityObservations: rightObservations, ...rightFacts } = right;

  return {
    ...((leftObservations !== undefined || rightObservations !== undefined) && {
      identityObservations: uniqueRecords([
        ...(leftObservations ?? []),
        ...(rightObservations ?? []),
      ]),
    }),
    ...mergeCompatible(leftFacts, rightFacts, `project '${projectKey(left)}'`),
    ...((leftEvidence !== undefined || rightEvidence !== undefined) && {
      evidence: sortedStrings([...(leftEvidence ?? []), ...(rightEvidence ?? [])]),
    }),
  };
}

/** Unknown/additive scalar or native-array conflicts must not become order-dependent first-wins. */
function mergeCompatible<T extends object>(left: T, right: T, path: string): T {
  const output: Record<string, unknown> = structuredClone(left) as Record<string, unknown>;

  for (const [key, value] of Object.entries(right)) {
    if (!Object.hasOwn(output, key) || output[key] === undefined) {
      setOwn(output, key, structuredClone(value));
    } else if (value !== undefined && canonicalJson(output[key]) !== canonicalJson(value)) {
      const existing = output[key];
      if (isObject(existing) && isObject(value)) {
        setOwn(output, key, mergeCompatible(existing, value, `${path}.${key}`));
      } else {
        throw new Error(
          `Conflicting observations at ${path}.${key}; retain context-specific facts on graph views`,
        );
      }
    }
  }

  return output as T;
}

// Defining an own property preserves native JSON keys such as __proto__ as data.
function setOwn(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
