import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  runCommand,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
  type PackageV2,
  type ProjectReference,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { basename, dirname } from "node:path";
import { markFiles } from "./conanfile.ts";
import { optionsSchema, type ConanOptions } from "./options.ts";
import type { ConanFileGraph, Node, Dependency } from "./types.ts";

export const extractorV2 = filesExtractorV2<ConanOptions>({
  name: "conanfile",
  version: 1,
  optionsSchema,
  markFiles,
  async extractFile(file, options, context) {
    const cmd = [options.conanPath, "graph", "info", file, "--format", "json"];
    if (options.profileBuild) cmd.push("--profile:build", options.profileBuild);
    if (options.profileHost) cmd.push("--profile:host", options.profileHost);
    cmd.push(...(options.conanArgs ?? []));
    const { stdout, stderr, exitCode } = await runCommand(cmd);
    if (exitCode !== 0) throw new Error(`Conan graph info failed (${exitCode}): ${stderr}`);
    const result = convertConanGraphV2(
      JSON.parse(stdout),
      context.relativeFile,
      context.codebaseId,
      options,
    );
    if (stderr.includes("WARN"))
      result.issues.push({
        code: "conanfile.command_warning",
        message: stderr,
        severity: "WARNING",
        file: context.relativeFile,
      });
    return result;
  },
});

/** Native graph IDs retain distinct host/build contexts and binary selections. */
export function convertConanGraphV2(
  input: ConanFileGraph,
  file: string,
  codebase: string,
  options: Partial<ConanOptions> = {},
): AnalyzerResultV2 {
  const graph = input?.graph;
  if (!graph?.nodes || typeof graph.nodes !== "object" || Array.isArray(graph.nodes))
    throw new Error("Conan output has no node map");
  if (graph.error !== undefined && graph.error !== null)
    throw new Error(`Conan graph error: ${JSON.stringify(graph.error)}`);
  const result = createEmptyResultV2(codebase);
  const packages = new Map<string, PackageV2>();
  const views = new Map<string, DependencyView>();
  const edges: DependencyEdge[] = [];
  const roots: Parameters<typeof createDependencyGraph>[0]["roots"] = [];
  const rootIds = new Set(Object.keys(graph.root ?? {}));
  const projects = new Map<string, ProjectReference>();
  for (const [id, node] of Object.entries(graph.nodes)) {
    const local =
      rootIds.has(id) || ["Editable", "Consumer", "Cli", "Platform"].includes(node.recipe);
    if (!node.name && !local) {
      result.issues.push({
        code: "conanfile.node_unresolvable",
        message: `Node ${id} has no package name`,
        severity: "WARNING",
        file,
      });
      continue;
    }
    const synthesized = !node.name;
    const purl = new PackageURL(
      "conan",
      node.user || null,
      node.name || (dirname(file) === "." ? "project" : basename(dirname(file))) || "project",
      node.version || null,
      { ...(node.rrev && { rrev: node.rrev }), ...(node.channel && { channel: node.channel }) },
      null,
    ).toString();
    let project: ProjectReference | undefined;
    if (local) {
      project = { purl, definitionFile: `${file}#node=${encodeURIComponent(id)}` };
      projects.set(id, project);
      result.subprojects.push({
        ...project,
        identityObservations: [
          {
            source: { extractor: "conanfile", files: [file], key: id },
            synthesizedPurl: synthesized,
          },
        ],
      });
    } else {
      packages.set(purl, { purl, evidence: [file] });
    }
    const attrs: JsonObject = {};
    for (const key of [
      "context",
      "package_id",
      "prev",
      "binary",
      "settings",
      "options",
      "ref",
      "test",
    ] as const) {
      if (node[key] !== undefined) attrs[`conan:${key}`] = node[key] as JsonObject[string];
    }
    views.set(id, {
      id,
      purl,
      ...(project && { project }),
      locator: id,
      dependencyCompleteness: node.dependencies === undefined ? "unknown" : "complete",
      attributes: attrs,
      evidence: [file],
    });
  }
  const kind = (dep: Dependency) => (dep.test ? "test" : dep.build ? "build" : "runtime");
  const addEdges = (from: string, node: Node, scope?: string) => {
    for (const [target, dep] of Object.entries(node.dependencies ?? {})) {
      // Conan reports transitive requirements too. They are not immediate adjacency.
      if (dep.direct === false || (scope && kind(dep) !== scope)) continue;
      const requested = {
        ...(dep.require && { specifier: dep.require }),
        attributes: { "conan:requirement": dep as unknown as JsonObject },
      };
      const common = {
        from,
        relation: "depends-on" as const,
        kind: kind(dep),
        requested,
        selection: dep.direct === true ? ("selected" as const) : ("unknown" as const),
        evidence: [file],
      };
      edges.push(
        views.has(target)
          ? { ...common, status: "resolved", to: target }
          : { ...common, status: "unresolved" },
      );
    }
  };
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!views.has(id)) continue;
    addEdges(id, node);
    const project = projects.get(id);
    if (!project) continue;
    for (const scope of ["runtime", "build", "test"]) {
      const root = `scope:${JSON.stringify([id, scope])}`;
      views.set(root, { ...views.get(id)!, id: root });
      roots.push({ id: root, node: root, project, scope });
      addEdges(root, node, scope);
    }
  }
  result.packages = [...packages.values()];
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "conanfile", files: [file] },
      interpretation: "resolved",
      rootCompleteness:
        rootIds.size > 0 && [...rootIds].every((id) => views.has(id)) ? "complete" : "unknown",
      nodes: [...views.values()],
      roots,
      edges,
      context: {
        ...(options.profileBuild && { "conan:profileBuild": options.profileBuild }),
        ...(options.profileHost && { "conan:profileHost": options.profileHost }),
        ...(options.conanArgs && { "conan:arguments": options.conanArgs }),
      },
    }),
  );
  return normalizeResultV2(result);
}
