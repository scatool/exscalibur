import { canonicalJson, sortedStrings, uniqueRecords } from "./json.ts";
import { normalizeResultV2 } from "./normalize.ts";
import { projectKey, validateResultV2 } from "./validate.ts";
import type { AnalyzerResultV2, DependencyGraph, PackageV2, SubprojectV2 } from "./types.ts";

export function createEmptyResultV2(codebase: string): AnalyzerResultV2 {
  if (!codebase) throw new Error("An analyzer result requires its codebase namespace");
  return { formatVersion: 2, codebase, packages: [], subprojects: [], graphs: [], issues: [] };
}

/**
 * Aggregate observations from one codebase. Graphs are never joined by PURL or variant attributes.
 * Equal observation IDs must have equal contents; conflicting IDs fail instead of corrupting topology.
 */
export function mergeResultsV2(
  inputs: readonly AnalyzerResultV2[],
  options: { codebase?: string } = {},
): AnalyzerResultV2 {
  const codebase = options.codebase ?? inputs[0]?.codebase;
  if (!codebase) throw new Error("Merging no results requires an explicit codebase namespace");
  const packages = new Map<string, PackageV2>();
  const projects = new Map<string, SubprojectV2>();
  const graphs = new Map<string, DependencyGraph>();
  const issues: AnalyzerResultV2["issues"] = [];
  let additionalFacts: object = {};

  for (const input of inputs) {
    validateResultV2(input);
    if (input.codebase !== codebase) {
      throw new Error(
        `Cannot merge codebase '${input.codebase}' into '${codebase}' without explicit reconciliation`,
      );
    }
    const result = normalizeResultV2(input);
    const { packages: _, subprojects: __, graphs: ___, issues: ____, ...facts } = result;
    additionalFacts = mergeCompatible(additionalFacts, facts, "result metadata");
    for (const pkg of result.packages) {
      const existing = packages.get(pkg.purl);
      packages.set(pkg.purl, existing ? mergePackage(existing, pkg) : pkg);
    }
    for (const project of result.subprojects) {
      const key = projectKey(project);
      const existing = projects.get(key);
      projects.set(key, existing ? mergeProject(existing, project) : project);
    }
    for (const graph of result.graphs) {
      const existing = graphs.get(graph.id);
      if (existing && canonicalJson(existing) !== canonicalJson(graph)) {
        throw new Error(`Conflicting dependency graph observation ID: ${graph.id}`);
      }
      graphs.set(graph.id, graph);
    }
    issues.push(...result.issues);
  }

  return normalizeResultV2({
    ...additionalFacts,
    formatVersion: 2,
    codebase,
    packages: [...packages.values()],
    subprojects: [...projects.values()],
    graphs: [...graphs.values()],
    issues,
  });
}

function mergePackage(left: PackageV2, right: PackageV2): PackageV2 {
  const { evidence: a, artifacts: artifactsA, externalReferences: refsA, ...factsA } = left;
  const { evidence: b, artifacts: artifactsB, externalReferences: refsB, ...factsB } = right;
  return {
    ...mergeCompatible(factsA, factsB, `package '${left.purl}'`),
    evidence: sortedStrings([...a, ...b]),
    ...((artifactsA !== undefined || artifactsB !== undefined) && {
      artifacts: uniqueRecords([...(artifactsA ?? []), ...(artifactsB ?? [])]),
    }),
    ...((refsA !== undefined || refsB !== undefined) && {
      externalReferences: uniqueRecords([...(refsA ?? []), ...(refsB ?? [])]),
    }),
  };
}

function mergeProject(left: SubprojectV2, right: SubprojectV2): SubprojectV2 {
  const { evidence: a, ...factsA } = left;
  const { evidence: b, ...factsB } = right;
  return {
    ...mergeCompatible(factsA, factsB, `project '${projectKey(left)}'`),
    ...((a !== undefined || b !== undefined) && {
      evidence: sortedStrings([...(a ?? []), ...(b ?? [])]),
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
