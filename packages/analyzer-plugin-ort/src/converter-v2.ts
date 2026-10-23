import { createHash } from "node:crypto";
import { join } from "node:path/posix";
import { isAbsolute, win32 } from "node:path";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResultV2,
  normalizeResultV2,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyRoot,
  type DependencyView,
  type JsonObject,
  type JsonValue,
  type PackageV2,
  type ProjectReference,
} from "@scatool/analyzer-core";
import { convertOrtIdToPurl } from "./id.ts";
import type { OrtAnalyzerResult, OrtDependencyGraph, OrtDependencyReference } from "./model.ts";

export type ConvertOrtResultV2Options = {
  codebase: string;
  /** Codebase-relative evidence locator of the imported ORT result. */
  evidenceFile: string;
  /** Optional codebase-relative prefix for ORT's project definition paths. */
  definitionFilePrefix?: string;
  toolVersion?: string;
  context?: JsonObject;
};

/**
 * Import native ORT topology directly. Never pass through the legacy PURL-edge projection:
 * package/fragment identities, project dependencies, empty projects and exact scope ownership matter.
 */
export function convertOrtResultV2(
  source: OrtAnalyzerResult,
  options: ConvertOrtResultV2Options,
): AnalyzerResultV2 {
  const result = createEmptyResultV2(options.codebase);
  const packages = new Map<string, PackageV2>();
  const identities = new Map<string, { purl: string; synthesized: boolean }>();
  const projects = new Map<string, ProjectReference>();
  const seenScopes = new Set<string>();
  const evidence = [options.evidenceFile];
  const projectScopes = asJson(
    (source.projects ?? []).map((project) => ({
      id: project.id,
      definition_file_path: project.definition_file_path,
      ...(project.scope_names !== undefined && { scope_names: project.scope_names }),
    })),
  );
  const explicitIdentities = new Map<string, string>();
  // Resolve native identity assertions before either catalog is built. Project/package ordering
  // must not discard a more precise explicit PURL or conceal conflicting assertions for one ID.
  for (const pkg of source.packages ?? []) {
    if (!pkg.purl) continue;
    let purl: string;
    try {
      purl = PackageURL.fromString(pkg.purl).toString();
    } catch {
      continue;
    }
    const existing = explicitIdentities.get(pkg.id);
    if (existing !== undefined && existing !== purl) {
      throw new Error(`Conflicting explicit PURLs for ORT identifier '${pkg.id}'`);
    }
    explicitIdentities.set(pkg.id, purl);
  }

  const identity = (id: string) => {
    const existing = identities.get(id);
    if (existing) return existing;
    let purl: string | undefined;
    let synthesized = false;
    const candidates = [explicitIdentities.get(id)];
    try {
      candidates.push(convertOrtIdToPurl(id));
    } catch {
      /* Fall back to a generic identity below. */
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        purl = PackageURL.fromString(candidate).toString();
        break;
      } catch {
        /* Try native coordinates next. */
      }
    }
    if (purl === undefined) {
      const key = createHash("sha256")
        .update(JSON.stringify([options.codebase, options.evidenceFile, id]))
        .digest("hex");
      purl = new PackageURL("generic", "ort", `component-${key}`, null, null, null).toString();
      synthesized = true;
      result.issues.push({
        code: "ort.synthesized_purl",
        severity: "HINT",
        file: options.evidenceFile,
        message: `Synthesized a generic PURL for ORT identifier '${id}'`,
      });
    }
    const value = { purl, synthesized };
    identities.set(id, value);
    return value;
  };

  for (const project of source.projects ?? []) {
    if (projects.has(project.id))
      throw new Error(`Duplicate ORT project identifier: ${project.id}`);
    const subject = identity(project.id);
    const nativeFile = project.definition_file_path.replaceAll("\\", "/");
    const reference = {
      purl: subject.purl,
      definitionFile: nativeFile
        ? isAbsolute(nativeFile) || win32.isAbsolute(nativeFile)
          ? nativeFile
          : join(options.definitionFilePrefix ?? "", nativeFile)
        : options.evidenceFile,
    };
    projects.set(project.id, reference);
    result.subprojects.push({
      ...reference,
      evidence,
      ...(subject.synthesized && { synthesizedPurl: true }),
    });
  }
  for (const pkg of source.packages ?? []) {
    const subject = identity(pkg.id);
    if (!packages.has(subject.purl)) {
      packages.set(subject.purl, {
        purl: subject.purl,
        evidence,
        ...(subject.synthesized && { synthesizedPurl: true }),
      });
    }
  }

  const globalIssues = (id: string) => source.issues?.[id] ?? [];
  const partial = (issues: unknown[]) =>
    issues.some(
      (issue) =>
        issue !== null &&
        typeof issue === "object" &&
        "severity" in issue &&
        issue.severity === "ERROR",
    );

  for (const [manager, nativeGraph] of Object.entries(source.dependency_graphs ?? {})) {
    const nodes = new Map<string, DependencyView>();
    const edges: DependencyEdge[] = [];
    const roots: DependencyRoot[] = [];
    const nativeNodeIds: string[] = [];

    const nodeKey = (pkg: number, fragment: number) => {
      if (!Number.isInteger(pkg) || pkg < 0 || !nativeGraph.packages[pkg]) {
        throw new Error(`ORT graph '${manager}' references invalid package index ${pkg}`);
      }
      if (!Number.isInteger(fragment) || fragment < 0) {
        throw new Error(`ORT graph '${manager}' references invalid fragment ${fragment}`);
      }
      return `ort:${JSON.stringify([nativeGraph.packages[pkg], fragment])}`;
    };
    const register = (nativeNode: OrtDependencyReference): string => {
      const pkg = nativeNode.pkg ?? 0;
      const fragment = nativeNode.fragment ?? 0;
      const key = nodeKey(pkg, fragment);
      const id = nativeGraph.packages[pkg]!;
      const subject = identity(id);
      const project = projects.get(id);
      for (const nativeIssue of nativeNode.issues ?? []) {
        if (
          nativeIssue === null ||
          typeof nativeIssue !== "object" ||
          !("message" in nativeIssue) ||
          typeof nativeIssue.message !== "string" ||
          !nativeIssue.message
        )
          continue;
        const severity = "severity" in nativeIssue ? nativeIssue.severity : undefined;
        result.issues.push({
          code: "ort.external_issue",
          message: nativeIssue.message,
          severity: severity === "ERROR" || severity === "WARNING" ? severity : "HINT",
          file:
            "affectedPath" in nativeIssue && typeof nativeIssue.affectedPath === "string"
              ? nativeIssue.affectedPath
              : project?.definitionFile || options.evidenceFile,
        });
      }
      if (!project && !packages.has(subject.purl)) {
        packages.set(subject.purl, {
          purl: subject.purl,
          evidence,
          ...(subject.synthesized && { synthesizedPurl: true }),
        });
      }
      if (!nodes.has(key)) {
        const issues = [...globalIssues(id), ...(nativeNode.issues ?? [])];
        nodes.set(key, {
          id: key,
          purl: subject.purl,
          ...(project && { project }),
          locator: JSON.stringify([id, fragment]),
          dependencyCompleteness: partial(issues) ? "partial" : "complete",
          evidence,
          attributes: {
            "ort:identifier": id,
            "ort:fragment": fragment,
            ...(nativeNode.linkage !== undefined && { "ort:linkage": nativeNode.linkage }),
            ...(issues.length > 0 && { "ort:issues": asJson(issues) }),
          },
        });
      } else {
        const existing = nodes.get(key)!;
        const metadata = existing.attributes!;
        if (nativeNode.linkage !== undefined) {
          const previous = metadata["ort:linkage"];
          if (previous !== undefined && previous !== nativeNode.linkage) {
            throw new Error(`Conflicting linkage for ORT dependency view '${key}'`);
          }
          metadata["ort:linkage"] = nativeNode.linkage;
        }
        const previousIssues = metadata["ort:issues"] as JsonValue[] | undefined;
        const issues = [
          ...(previousIssues ?? []),
          ...globalIssues(id),
          ...(nativeNode.issues ?? []),
        ];
        if (issues.length > 0) {
          metadata["ort:issues"] = [...new Set(issues.map((issue) => stableJson(issue)))]
            .sort()
            .map((issue) => JSON.parse(issue));
          if (partial(issues) && existing.dependencyCompleteness !== "unknown") {
            existing.dependencyCompleteness = "partial";
          }
        }
      }
      return key;
    };

    if (nativeGraph.nodes && nativeGraph.nodes.length > 0) {
      for (const nativeNode of nativeGraph.nodes) {
        const key = register(nativeNode);
        if (nativeNodeIds.includes(key))
          throw new Error(`Duplicate ORT package/fragment in graph '${manager}': ${key}`);
        nativeNodeIds.push(key);
      }
      for (const dependency of nativeGraph.edges ?? []) {
        const from = nativeNodeIds[dependency.from];
        const to = nativeNodeIds[dependency.to];
        if (!from || !to)
          throw new Error(`ORT graph '${manager}' references an unknown dependency node`);
        edges.push(resolved(from, to));
      }
    } else {
      if ((nativeGraph.edges?.length ?? 0) > 0) {
        throw new Error(
          `ORT graph '${manager}' has indexed dependency edges without an indexed node table`,
        );
      }
      importLegacyTree(nativeGraph, register, edges);
    }

    for (const [scopeKey, dependencies] of Object.entries(nativeGraph.scopes ?? {})) {
      let owners = (source.projects ?? []).flatMap((project) => {
        const prefix = `${project.id.slice(project.id.indexOf(":") + 1)}:`;
        return scopeKey.startsWith(prefix)
          ? [{ project, scope: scopeKey.slice(prefix.length) }]
          : [];
      });
      const declaredOwners = owners.filter(({ project, scope }) =>
        project.scope_names?.includes(scope),
      );
      if (declaredOwners.length > 0) owners = declaredOwners;
      if (owners.length > 1) {
        const managerType = manager === "GradleInspector" ? "Gradle" : manager;
        const nativeOwners = owners.filter(
          ({ project }) =>
            project.id.slice(0, project.id.indexOf(":")).toLowerCase() ===
            managerType.toLowerCase(),
        );
        if (nativeOwners.length === 1) owners = nativeOwners;
      }
      if (owners.length !== 1) {
        throw new Error(
          `ORT scope '${scopeKey}' in graph '${manager}' must identify exactly one source project`,
        );
      }
      const { project, scope } = owners[0]!;
      const reference = projects.get(project.id)!;
      const entry = `scope:${JSON.stringify(scopeKey)}`;
      nodes.set(entry, {
        id: entry,
        purl: reference.purl,
        project: reference,
        dependencyCompleteness: partial(globalIssues(project.id)) ? "partial" : "complete",
        evidence,
      });
      roots.push({ id: scopeKey, project: reference, scope, node: entry, evidence });
      seenScopes.add(JSON.stringify([project.id, scope]));
      for (const dependency of dependencies) {
        const target = nodeKey(dependency.root, dependency.fragment ?? 0);
        if (!nodes.has(target)) {
          // A scope reference establishes this dependency's identity and presence. Its missing
          // node table record leaves outgoing adjacency unknown, rather than erasing the package.
          register({ pkg: dependency.root, fragment: dependency.fragment ?? 0 });
          nodes.get(target)!.dependencyCompleteness = "unknown";
          nodes.get(target)!.attributes!["ort:missingNode"] = true;
          result.issues.push({
            code: "ort.missing_dependency_node",
            severity: "WARNING",
            file: options.evidenceFile,
            message: `ORT scope '${scopeKey}' references a dependency view absent from its graph: ${target}`,
          });
        }
        edges.push(resolved(entry, target));
      }
    }
    result.graphs.push(
      createDependencyGraph({
        source: {
          extractor: "ort",
          files: evidence,
          key: manager,
          tool: {
            name: "ORT",
            ...(options.toolVersion !== undefined && { version: options.toolVersion }),
          },
        },
        interpretation: "resolved",
        ...(options.context !== undefined && { context: options.context }),
        rootCompleteness: "complete",
        roots,
        nodes: [...nodes.values()],
        edges,
        attributes: { "ort:manager": manager, "ort:projectScopes": projectScopes },
      }),
    );
  }

  const unreported = unreportedScopes(source, projects, seenScopes, options.evidenceFile);
  unreported.attributes = { "ort:projectScopes": projectScopes };
  if (options.context !== undefined) unreported.context = options.context;
  unreported.source.tool = {
    name: "ORT",
    ...(options.toolVersion !== undefined && { version: options.toolVersion }),
  };
  if (unreported.roots.length > 0 || (result.graphs.length === 0 && projects.size > 0)) {
    result.graphs.push(createDependencyGraph(unreported));
  }
  if (unreported.roots.length > 0) {
    result.issues.push({
      code: "ort.unreported_scopes",
      severity: "HINT",
      file: options.evidenceFile,
      message:
        "Some ORT projects list scopes whose dependency graphs were not reported; their closures remain unknown",
    });
  }
  for (const [id, issues] of Object.entries(source.issues ?? {})) {
    for (const issue of issues) {
      result.issues.push({
        code: "ort.external_issue",
        message: issue.message,
        severity: issue.severity,
        file: issue.affectedPath || projects.get(id)?.definitionFile || options.evidenceFile,
      });
    }
  }
  result.packages = [...packages.values()];
  return normalizeResultV2(result);
}

function resolved(from: string, to: string): DependencyEdge {
  return { from, to, status: "resolved", relation: "depends-on", selection: "selected" };
}

function importLegacyTree(
  graph: OrtDependencyGraph,
  register: (node: OrtDependencyReference) => string,
  edges: DependencyEdge[],
): void {
  const childrenByView = new Map<string, string>();
  const visit = (node: OrtDependencyReference, ancestors: Set<OrtDependencyReference>): string => {
    if (ancestors.has(node)) throw new Error("Cyclic in-memory legacy ORT dependency references");
    const next = new Set(ancestors).add(node);
    const from = register(node);
    const children = (node.dependencies ?? []).map((dependency) => visit(dependency, next));
    const signature = JSON.stringify([...new Set(children)].sort());
    const previous = childrenByView.get(from);
    if (previous !== undefined && previous !== signature) {
      throw new Error(`Conflicting dependency sets for legacy ORT view '${from}'`);
    }
    childrenByView.set(from, signature);
    for (const target of children) edges.push(resolved(from, target));
    return from;
  };
  for (const node of graph.scope_roots ?? []) visit(node, new Set());
}

function unreportedScopes(
  result: OrtAnalyzerResult,
  projects: Map<string, ProjectReference>,
  reported: Set<string>,
  evidenceFile: string,
): Omit<DependencyGraph, "id"> {
  const graph: Omit<DependencyGraph, "id"> = {
    source: { extractor: "ort", files: [evidenceFile], key: "unreported-scopes" },
    interpretation: "unknown",
    rootCompleteness: (result.projects ?? []).some((project) => project.scope_names === undefined)
      ? "unknown"
      : "complete",
    roots: [],
    nodes: [],
    edges: [],
  };
  for (const project of result.projects ?? []) {
    for (const scope of project.scope_names ?? []) {
      if (reported.has(JSON.stringify([project.id, scope]))) continue;
      const id = JSON.stringify([project.id, scope]);
      const reference = projects.get(project.id)!;
      graph.roots.push({ id, project: reference, scope, node: id });
      graph.nodes.push({
        id,
        purl: reference.purl,
        project: reference,
        dependencyCompleteness: "unknown",
      });
    }
  }
  return graph;
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}
