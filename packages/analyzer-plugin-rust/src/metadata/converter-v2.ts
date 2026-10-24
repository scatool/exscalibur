import { join, normalize, relative } from "node:path/posix";
import {
  mergeResultsV2,
  type AnalyzerResultV2,
  type DependencyCondition,
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
} from "../cargo-v2.ts";

/** Import Cargo's package-resolution projection; this is not a compilation-unit graph. */
export function convertCargoMetadataV2(
  input: unknown,
  options: CargoObservationOptions,
): AnalyzerResultV2 {
  const document = record(input);
  if (document.version !== 1)
    throw new Error(`Unsupported Cargo metadata format: ${JSON.stringify(document.version)}`);
  const packages = new Map<string, CargoRecord>();
  for (const value of array(document.packages)) {
    const pkg = record(value),
      id = text(pkg.id);
    if (packages.has(id)) throw new Error(`Duplicate Cargo package ID: ${id}`);
    text(pkg.name);
    text(pkg.version);
    packages.set(id, pkg);
  }
  const resolve =
    document.resolve === null || document.resolve === undefined
      ? undefined
      : record(document.resolve);
  const resolved = new CargoObservation(
    options,
    "package-resolution",
    resolve ? "resolved" : "unknown",
    "cargometadata",
  );
  const declared = new CargoObservation(
    options,
    "manifest-declarations",
    "declared",
    "cargometadata",
  );
  const members = strings(document.workspace_members);
  const byNode = new Map<string, CargoRecord>();
  const declaredId = (id: string) => JSON.stringify(["package", id]);
  const scopeId = (id: string, scope: string) => JSON.stringify(["scope", id, scope]);
  if (resolve)
    for (const value of array(resolve.nodes)) {
      const node = record(value),
        id = text(node.id);
      if (byNode.has(id)) throw new Error(`Duplicate Cargo resolve node: ${id}`);
      byNode.set(id, node);
    }
  for (const builder of [resolved, declared]) {
    builder.attributes["cargo:metadata"] = json(document);
    builder.attributes["cargo:projection"] =
      builder === resolved ? "metadata-package-membership" : "metadata-manifest-declarations";
    builder.attributes["cargo:compilationUnits"] = "not-observed";
  }
  resolved.issue(
    "cargo.package_resolution_projection",
    "Cargo metadata records package-level bindings and features; compilation-unit features, host/target roles and runtime membership were not observed",
    "HINT",
  );
  if (!resolve)
    resolved.issue(
      "cargo.resolution_not_observed",
      "Cargo metadata has no resolve graph; package inventory and declarations do not establish resolved dependencies",
    );
  const path = (pkg: CargoRecord, id: string): { definition: string; identity: string } => {
    const fallback = `${options.evidenceFile}#cargo-project=${encodeURIComponent(id)}`;
    if (typeof pkg.manifest_path !== "string") return { definition: fallback, identity: fallback };
    const manifest = normalize(pkg.manifest_path.replaceAll("\\", "/"));
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
  const register = (id: string): void => {
    if (resolved.nodes.has(id)) return;
    const pkg = packages.get(id),
      node = byNode.get(id);
    const identity = pkg
      ? cargoIdentity(text(pkg.name), text(pkg.version), pkg.source, [
          options.codebase,
          "manifest",
          path(pkg, id).identity,
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
        ...(pkg && { "cargo:package": json(pkg) }),
        ...(node && { "cargo:resolveNode": json(node) }),
        ...(node?.features !== undefined && {
          "cargo:packageResolutionFeatures": json(strings(node.features)),
        }),
      },
    };
    resolved.package(view, identity.synthesizedPurl);
    declared.package(
      {
        ...structuredClone(view),
        id: declaredId(id),
        dependencyCompleteness: pkg && Array.isArray(pkg.dependencies) ? "complete" : "unknown",
      },
      identity.synthesizedPurl,
    );
    if (!pkg)
      resolved.issue(
        "cargo.missing_package",
        `Native package ID '${id}' has no package record; its PURL is synthesized and its source identity remains unknown`,
      );
  };
  for (const id of new Set([...packages.keys(), ...byNode.keys(), ...members])) register(id);
  const projects = new Map<string, ProjectReference>();
  for (const id of new Set(members)) {
    const definition = path(packages.get(id) ?? {}, id).definition;
    projects.set(id, resolved.project(id, definition));
    declared.project(declaredId(id), definition);
    // This root deliberately includes all recorded kinds, including member development deps.
    resolved.root(projects.get(id)!, "cargo:metadata", id);
  }
  resolved.rootCompleteness = members.every((id) => packages.has(id)) ? "complete" : "partial";
  declared.rootCompleteness = resolved.rootCompleteness;
  for (const [id, pkg] of packages) {
    const declarations =
      pkg.dependencies === undefined ? undefined : array(pkg.dependencies).map(record);
    if (!declarations) {
      const project = projects.get(id);
      if (project) {
        declared.rootCompleteness = "partial";
        const rootId = scopeId(id, "cargo:unreported-declarations");
        declared.nodes.set(rootId, {
          id: rootId,
          purl: project.purl,
          project,
          dependencyCompleteness: "unknown",
          evidence: [options.evidenceFile],
        });
        declared.root(project, "cargo:unreported-declarations", rootId);
      }
      continue;
    }
    for (const declaration of declarations) {
      const request = declarationRequest(declaration);
      const condition = activation(declaration);
      const kind = cargoKind(declaration.kind);
      const edge = {
        from: declaredId(id),
        status: "declared" as const,
        relation: "depends-on" as const,
        kind,
        requested: request,
        ...(optional(declaration) !== undefined && { optional: optional(declaration) }),
        evidence: [options.evidenceFile],
        attributes: { "cargo:declaration": json(declaration) },
        ...(condition
          ? { selection: "conditional" as const, condition }
          : { selection: "selected" as const }),
      };
      declared.edges.push(edge);
      const project = projects.get(id);
      if (project) {
        const rootId = scopeId(id, kind);
        if (!declared.nodes.has(rootId)) {
          declared.nodes.set(rootId, {
            id: rootId,
            purl: project.purl,
            project,
            dependencyCompleteness: "complete",
            evidence: [options.evidenceFile],
          });
          declared.root(project, kind, rootId);
        }
        declared.edges.push({ ...edge, from: rootId });
      }
    }
    const project = projects.get(id);
    if (project)
      for (const kind of ["dependencies", "dev-dependencies", "build-dependencies"]) {
        const rootId = scopeId(id, kind);
        if (declared.nodes.has(rootId)) continue;
        declared.nodes.set(rootId, {
          id: rootId,
          purl: project.purl,
          project,
          dependencyCompleteness: "complete",
          evidence: [options.evidenceFile],
        });
        declared.root(project, kind, rootId);
      }
  }
  for (const [id, node] of byNode) {
    if (!Array.isArray(node.deps)) {
      if (node.dependencies === undefined) continue;
      resolved.issue(
        "cargo.legacy_resolution_edges",
        `Node '${id}' supplies only legacy package-ID edges; dependency names, kinds and predicates remain unreported`,
        "HINT",
      );
      for (const target of strings(node.dependencies)) {
        register(target);
        resolved.edges.push({
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
      const dep = record(value),
        target = text(dep.pkg);
      text(dep.name);
      register(target);
      const depKinds = dep.dep_kinds === undefined ? [] : array(dep.dep_kinds).map(record);
      for (const kind of depKinds.length > 0 ? depKinds : [{}]) {
        const candidates =
          Object.hasOwn(kind, "kind") && Object.hasOwn(kind, "target")
            ? matchingDeclarations(packages.get(id), packages.get(target), dep, kind)
            : [];
        const nativeCondition = targetCondition(kind.target);
        const requested: DependencyRequest =
          candidates.length === 1
            ? declarationRequest(candidates[0]!)
            : { attributes: { "cargo:resolutionExternName": text(dep.name) } };
        if (nativeCondition) requested.condition = nativeCondition;
        resolved.edges.push({
          from: id,
          to: target,
          status: "resolved",
          relation: "depends-on",
          selection: "selected",
          kind: depKinds.length > 0 ? cargoKind(kind.kind) : "cargo:unreported-kind",
          requested,
          ...(candidates.length === 1 &&
            optional(candidates[0]!) !== undefined && { optional: optional(candidates[0]!) }),
          evidence: [options.evidenceFile],
          attributes: {
            "cargo:resolutionDependency": json(dep),
            "cargo:depKind": json(kind),
            "cargo:matchingDeclarations": json(candidates),
          },
        });
      }
    }
  }
  return mergeResultsV2([resolved.finish(), declared.finish()]);
}

function matchingDeclarations(
  owner: CargoRecord | undefined,
  target: CargoRecord | undefined,
  dep: CargoRecord,
  kind: CargoRecord,
): CargoRecord[] {
  if (!owner || !target || !Array.isArray(owner.dependencies)) return [];
  return owner.dependencies.map(record).filter((declaration) => {
    if (
      !Object.hasOwn(declaration, "kind") ||
      !Object.hasOwn(declaration, "target") ||
      declaration.name !== target.name ||
      declaration.kind !== kind.kind ||
      declaration.target !== kind.target
    )
      return false;
    const names =
      typeof declaration.rename === "string"
        ? [declaration.rename]
        : Array.isArray(target.targets)
          ? target.targets
              .map(record)
              .filter(
                (entry) =>
                  Array.isArray(entry.kind) &&
                  entry.kind.some((value) =>
                    ["lib", "rlib", "dylib", "staticlib", "cdylib", "proc-macro"].includes(
                      String(value),
                    ),
                  ),
              )
              .map((entry) => text(entry.name))
          : [text(target.name)];
    return names.some((name) => name.replaceAll("-", "_") === (kind.extern_name ?? dep.name));
  });
}
function declarationRequest(declaration: CargoRecord): DependencyRequest {
  return {
    name: typeof declaration.rename === "string" ? declaration.rename : text(declaration.name),
    specifier: text(declaration.req),
    ...(declaration.features !== undefined && { features: strings(declaration.features) }),
    ...(targetCondition(declaration.target) && { condition: targetCondition(declaration.target) }),
    attributes: { "cargo:declaration": json(declaration) },
  };
}
function optional(value: CargoRecord): boolean | undefined {
  if (value.optional !== undefined && typeof value.optional !== "boolean")
    throw new Error("Invalid Cargo optional flag");
  return value.optional as boolean | undefined;
}
function targetCondition(value: unknown): DependencyCondition | undefined {
  return value === null || value === undefined
    ? undefined
    : {
        language: "cargo:target-predicate/v1",
        expression: text(value),
        environment: "cargo:declaring-compilation-unit",
      };
}
function activation(value: CargoRecord): DependencyCondition | undefined {
  const optionalDependency =
    optional(value) === true
      ? typeof value.rename === "string"
        ? value.rename
        : text(value.name)
      : undefined;
  return value.target === null || value.target === undefined
    ? optionalDependency === undefined
      ? undefined
      : {
          language: "cargo:manifest-activation/v1",
          expression: { optionalDependency },
          environment: "cargo:declaring-compilation-unit",
        }
    : {
        language: "cargo:manifest-activation/v1",
        expression: {
          target: text(value.target),
          ...(optionalDependency && { optionalDependency }),
        },
        environment: "cargo:declaring-compilation-unit",
      };
}
