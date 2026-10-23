import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  readNormalizedTextFile,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
  type PackageV2,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { basename, dirname } from "node:path";
import { optionsSchema, type VcpkgOptions } from "./options.ts";
import { markFiles, portToVersion } from "./vcpkg.ts";
import { retrievePortInfo } from "./portInfo.ts";
import type { VcpkgPort, VcpkgDependencyObject } from "./types.ts";

type Declaration = {
  dependency: string | VcpkgDependencyObject;
  feature?: string;
  supports?: string;
};
function declarations(port: VcpkgPort): Declaration[] {
  return [
    ...(port.dependencies ?? []).map((dependency) => ({ dependency })),
    ...Object.entries(port.features ?? {}).flatMap(([feature, definition]) =>
      (definition.dependencies ?? []).map((dependency) => ({
        dependency,
        feature,
        ...(definition.supports && { supports: definition.supports }),
      })),
    ),
  ];
}

export const extractorV2 = filesExtractorV2<VcpkgOptions>({
  name: "vcpkg",
  version: 1,
  optionsSchema,
  markFiles,
  async extractFile(file, options, context) {
    const root: VcpkgPort = JSON.parse(await readNormalizedTextFile(file));
    const ports: Record<string, VcpkgPort> = Object.create(null);
    const attempted = new Set<string>();
    let pending = [root];
    while (pending.length) {
      const names = [
        ...new Set(
          pending.flatMap((port) =>
            declarations(port).map(({ dependency }) =>
              typeof dependency === "string" ? dependency : dependency.name,
            ),
          ),
        ),
      ].filter((name) => !attempted.has(name));
      if (!names.length) break;
      names.forEach((name) => attempted.add(name));
      const fetched = await retrievePortInfo(names, dirname(file), options.vcpkgPath);
      if (!fetched || typeof fetched !== "object" || Array.isArray(fetched))
        throw new Error("vcpkg returned no port information map");
      pending = [];
      for (const name of names)
        if (fetched[name]) {
          ports[name] = fetched[name];
          pending.push(fetched[name]);
        }
    }
    return convertVcpkgPortsV2(root, ports, context.relativeFile, context.codebaseId, options);
  },
});

/** Registry candidates are not resolver selections; no host/target feature union is fabricated. */
export function convertVcpkgPortsV2(
  root: VcpkgPort,
  ports: Record<string, VcpkgPort>,
  file: string,
  codebase: string,
  options: Partial<VcpkgOptions> = {},
): AnalyzerResultV2 {
  if (!root || typeof root !== "object" || Array.isArray(root))
    throw new Error("Invalid vcpkg manifest");
  const result = createEmptyResultV2(codebase);
  const purl = (name: string, port: VcpkgPort) =>
    new PackageURL(
      "vcpkg",
      null,
      name,
      portToVersion(port) ?? null,
      port["port-version"] !== undefined ? { port_version: String(port["port-version"]) } : null,
      null,
    ).toString();
  const project = {
    purl: purl(
      root.name || (dirname(file) === "." ? "project" : basename(dirname(file))) || "project",
      root,
    ),
    definitionFile: file,
  };
  result.subprojects.push({
    ...project,
    identityObservations: [
      { source: { extractor: "vcpkg", files: [file] }, synthesizedPurl: !root.name },
    ],
  });
  const packages = new Map<string, PackageV2>();
  const nodes: DependencyView[] = [];
  const edges: DependencyEdge[] = [];
  const roots: Parameters<typeof createDependencyGraph>[0]["roots"] = [];
  const nodeId = (name: string, domain: string) => JSON.stringify([name, domain]);
  const makeNode = (name: string, port: VcpkgPort, domain: string) => {
    const id = nodeId(name, domain);
    const rootNode = name === "[root]";
    const coordinates = rootNode ? project.purl : purl(port.name || name, port);
    if (!rootNode) packages.set(coordinates, { purl: coordinates, evidence: [file] });
    nodes.push({
      id,
      purl: coordinates,
      ...(rootNode && { project }),
      dependencyCompleteness: "complete",
      attributes: { "vcpkg:domain": domain, "vcpkg:manifest": port as unknown as JsonObject },
      evidence: [file],
    });
    return id;
  };
  for (const domain of ["target", "host"]) {
    const id = makeNode("[root]", root, domain);
    roots.push({ id, node: id, project, scope: domain });
    for (const [name, port] of Object.entries(ports)) makeNode(name, port, domain);
  }
  for (const [name, port] of [["[root]", root], ...Object.entries(ports)] as [
    string,
    VcpkgPort,
  ][]) {
    for (const domain of ["target", "host"]) {
      for (const declaration of declarations(port)) {
        const dep =
          typeof declaration.dependency === "string"
            ? { name: declaration.dependency }
            : declaration.dependency;
        if (!dep.name) throw new Error("vcpkg dependency has no name");
        // Root scopes partition native host and target requirements. Host dependencies of a
        // target package cross into a host view; dependencies of host packages remain host-side.
        if (name === "[root]" && Boolean(dep.host) !== (domain === "host")) continue;
        const targetDomain = dep.host || domain === "host" ? "host" : "target";
        const expressions: JsonObject = {};
        if (dep.platform) expressions.platform = dep.platform;
        if (declaration.feature) expressions.feature = declaration.feature;
        if (declaration.supports) expressions.featureSupports = declaration.supports;
        if (port.supports) expressions.supports = port.supports;
        const condition = Object.keys(expressions).length
          ? { language: "vcpkg:declaration", environment: domain, expression: expressions }
          : undefined;
        const requested = {
          name: dep.name,
          ...(dep["version>="] && { specifier: `>=${dep["version>="]}` }),
          ...(condition && { condition }),
          // Conditional feature requests remain in native data, never promoted to enabledFeatures.
          ...(dep.features && {
            features: dep.features.filter(
              (feature): feature is string => typeof feature === "string",
            ),
          }),
          attributes: { "vcpkg:request": declaration.dependency as unknown as JsonObject[string] },
        };
        const common = {
          from: nodeId(name, domain),
          relation: "depends-on" as const,
          kind: dep.host ? "host" : "target",
          requested,
          selection: "unknown" as const,
          ...(condition && { condition }),
          evidence: [file],
        };
        if (Object.hasOwn(ports, dep.name))
          edges.push({
            ...common,
            status: "resolved",
            to: nodeId(dep.name, targetDomain),
            attributes: { "vcpkg:binding": "registry-candidate" },
          });
        else {
          edges.push({ ...common, status: "unresolved" });
          result.issues.push({
            code: "vcpkg.port_missing",
            message: `No registry candidate for ${dep.name}`,
            severity: "WARNING",
            file,
          });
        }
      }
    }
  }
  result.packages = [...packages.values()];
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "vcpkg", files: [file] },
      interpretation: "declared",
      rootCompleteness: "complete",
      nodes,
      roots,
      edges,
      context: {
        ...(options.targetPlatform && { "vcpkg:targetPlatform": options.targetPlatform }),
        "vcpkg:includeAllFeatures": options.includeAllFeatures ?? false,
      },
      attributes: { "vcpkg:projection": "registry-declarations", "vcpkg:resolution": "unobserved" },
    }),
  );
  return normalizeResultV2(result);
}
