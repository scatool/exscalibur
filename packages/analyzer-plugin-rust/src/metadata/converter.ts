import { join, normalize, relative } from "node:path/posix";
import {
  mergeResults,
  type AnalyzerResult,
  type DependencyRequest,
  type DependencyView,
  type ProjectReference,
} from "@scatool/analyzer-core";
import {
  CargoObservation,
  array,
  cargoIdentity,
  cargoKind,
  cargoUnknownIdentity,
  json,
  record,
  strings,
  text,
  type CargoObservationOptions,
  type CargoRecord,
} from "../observation.ts";
import {
  addManifestDeclarations,
  declarationNodeId,
  requestFromDeclaration,
  findMatchingDeclarations,
  readOptionalFlag,
  targetCondition,
} from "./declarations.ts";

/** Import Cargo's package-resolution projection; this is not a compilation-unit graph. */
export function convertCargoMetadata(
  input: unknown,
  options: CargoObservationOptions,
): AnalyzerResult {
  const document = record(input);
  if (document.version !== 1)
    throw new Error(`Unsupported Cargo metadata format: ${JSON.stringify(document.version)}`);

  // Index both native inventories before resolving references between them.
  const packagesById = new Map<string, CargoRecord>();
  for (const value of array(document.packages)) {
    const nativePackage = record(value);
    const id = text(nativePackage.id);
    if (packagesById.has(id)) throw new Error(`Duplicate Cargo package ID: ${id}`);
    text(nativePackage.name);
    text(nativePackage.version);
    packagesById.set(id, nativePackage);
  }

  const resolve =
    document.resolve === null || document.resolve === undefined
      ? undefined
      : record(document.resolve);

  const packageResolution = new CargoObservation(
    options,
    "package-resolution",
    resolve ? "resolved" : "unknown",
    "cargometadata",
  );
  const manifestDeclarations = new CargoObservation(
    options,
    "manifest-declarations",
    "declared",
    "cargometadata",
  );

  const workspaceMembers = strings(document.workspace_members);
  const resolutionNodes = new Map<string, CargoRecord>();
  if (resolve)
    for (const value of array(resolve.nodes)) {
      const node = record(value);
      const id = text(node.id);
      if (resolutionNodes.has(id)) throw new Error(`Duplicate Cargo resolve node: ${id}`);
      resolutionNodes.set(id, node);
    }

  // Keep resolution and declarations separate: they make different completeness claims.
  for (const builder of [packageResolution, manifestDeclarations]) {
    builder.attributes["cargo:metadata"] = json(document);
    builder.attributes["cargo:projection"] =
      builder === packageResolution
        ? "metadata-package-membership"
        : "metadata-manifest-declarations";
    builder.attributes["cargo:compilationUnits"] = "not-observed";
  }

  packageResolution.issue(
    "cargo.package_resolution_projection",
    "Cargo metadata records package-level bindings and features; compilation-unit features, host/target roles and runtime membership were not observed",
    "HINT",
  );
  if (!resolve)
    packageResolution.issue(
      "cargo.resolution_not_observed",
      "Cargo metadata has no resolve graph; package inventory and declarations do not establish resolved dependencies",
    );

  const projectLocation = (
    nativePackage: CargoRecord,
    id: string,
  ): { definition: string; identity: string } => {
    const fallback = `${options.evidenceFile}#cargo-project=${encodeURIComponent(id)}`;
    if (typeof nativePackage.manifest_path !== "string")
      return { definition: fallback, identity: fallback };
    const manifest = normalize(nativePackage.manifest_path.replaceAll("\\", "/"));
    const root =
      typeof document.workspace_root === "string"
        ? normalize(document.workspace_root.replaceAll("\\", "/"))
        : undefined;
    if (
      options.definitionFilePrefix !== undefined &&
      root &&
      manifest.startsWith(`${root.replace(/\/$/, "")}/`)
    ) {
      const definition = join(options.definitionFilePrefix, relative(root, manifest));
      return { definition, identity: `mapped:${definition}` };
    }
    // Export location does not implicitly map every native workspace to the same source root.
    return { definition: fallback, identity: `native:${manifest}` };
  };

  const registerPackageViews = (id: string): void => {
    if (packageResolution.nodes.has(id)) return;
    const nativePackage = packagesById.get(id);
    const node = resolutionNodes.get(id);
    const identity = nativePackage
      ? cargoIdentity(text(nativePackage.name), text(nativePackage.version), nativePackage.source, [
          options.codebase,
          "manifest",
          projectLocation(nativePackage, id).identity,
        ])
      : {
          purl: cargoUnknownIdentity("missing-package", [
            options.codebase,
            options.evidenceFile,
            id,
          ]),
          synthesizedPurl: true as const,
        };
    const view: DependencyView = {
      id,
      ...{ purl: identity.purl },
      locator: id,
      dependencyCompleteness:
        node && (Array.isArray(node.deps) || Array.isArray(node.dependencies))
          ? "complete"
          : "unknown",
      evidence: [options.evidenceFile],
      attributes: {
        ...(nativePackage && { "cargo:package": json(nativePackage) }),
        ...(node && { "cargo:resolveNode": json(node) }),
        ...(node?.features !== undefined && {
          "cargo:packageResolutionFeatures": json(strings(node.features)),
        }),
      },
    };
    packageResolution.package(view, identity.synthesizedPurl);
    manifestDeclarations.package(
      {
        ...structuredClone(view),
        id: declarationNodeId(id),
        dependencyCompleteness:
          nativePackage && Array.isArray(nativePackage.dependencies) ? "complete" : "unknown",
      },
      identity.synthesizedPurl,
    );
    if (!nativePackage)
      packageResolution.issue(
        "cargo.missing_package",
        `Native package ID '${id}' has no package record; its PURL is synthesized and its source identity remains unknown`,
      );
  };

  for (const id of new Set([
    ...packagesById.keys(),
    ...resolutionNodes.keys(),
    ...workspaceMembers,
  ]))
    registerPackageViews(id);

  // Workspace membership, not package presence, determines which views are projects.
  const projects = new Map<string, ProjectReference>();
  for (const id of new Set(workspaceMembers)) {
    const definition = projectLocation(packagesById.get(id) ?? {}, id).definition;
    projects.set(id, packageResolution.project(id, definition));
    manifestDeclarations.project(declarationNodeId(id), definition);
    // This root deliberately includes all recorded kinds, including member development deps.
    packageResolution.root(projects.get(id)!, "cargo:metadata", id);
  }

  packageResolution.rootCompleteness = workspaceMembers.every((id) => packagesById.has(id))
    ? "complete"
    : "partial";
  manifestDeclarations.rootCompleteness = packageResolution.rootCompleteness;

  addManifestDeclarations(manifestDeclarations, packagesById, projects, options);

  // Resolve bindings after every package and workspace view is registered.
  for (const [id, node] of resolutionNodes) {
    if (!Array.isArray(node.deps)) {
      if (node.dependencies === undefined) continue;
      packageResolution.issue(
        "cargo.legacy_resolution_edges",
        `Node '${id}' supplies only legacy package-ID edges; dependency names, kinds and predicates remain unreported`,
        "HINT",
      );
      for (const target of strings(node.dependencies)) {
        registerPackageViews(target);
        packageResolution.edges.push({
          from: id,
          to: target,
          status: "resolved",
          selection: "selected",
          relation: "depends-on",
          evidence: [options.evidenceFile],
          attributes: { "cargo:packageReference": target },
        });
      }
      continue;
    }
    for (const value of node.deps) {
      const resolutionDependency = record(value);
      const target = text(resolutionDependency.pkg);
      text(resolutionDependency.name);
      registerPackageViews(target);
      const depKinds =
        resolutionDependency.dep_kinds === undefined
          ? []
          : array(resolutionDependency.dep_kinds).map(record);
      for (const kind of depKinds.length > 0 ? depKinds : [{}]) {
        const candidates =
          Object.hasOwn(kind, "kind") && Object.hasOwn(kind, "target")
            ? findMatchingDeclarations(
                packagesById.get(id),
                packagesById.get(target),
                resolutionDependency,
                kind,
              )
            : [];
        const nativeCondition = targetCondition(kind.target);
        const requested: DependencyRequest =
          candidates.length === 1
            ? requestFromDeclaration(candidates[0]!)
            : { attributes: { "cargo:resolutionExternName": text(resolutionDependency.name) } };
        if (nativeCondition) requested.condition = nativeCondition;
        packageResolution.edges.push({
          from: id,
          to: target,
          status: "resolved",
          relation: "depends-on",
          selection: "selected",
          kind: depKinds.length > 0 ? cargoKind(kind.kind) : "cargo:unreported-kind",
          requested,
          ...(candidates.length === 1 &&
            readOptionalFlag(candidates[0]!) !== undefined && {
              optional: readOptionalFlag(candidates[0]!),
            }),
          evidence: [options.evidenceFile],
          attributes: {
            "cargo:resolutionDependency": json(resolutionDependency),
            "cargo:depKind": json(kind),
            "cargo:matchingDeclarations": json(candidates),
          },
        });
      }
    }
  }

  return mergeResults([packageResolution.finish(), manifestDeclarations.finish()]);
}
