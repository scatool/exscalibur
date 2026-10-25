import {
  type DependencyCondition,
  type DependencyRequest,
  type ProjectReference,
} from "@scatool/analyzer-core";
import {
  CargoObservation,
  array,
  cargoKind,
  json,
  record,
  strings,
  text,
  type CargoObservationOptions,
  type CargoRecord,
} from "../cargo-v2.ts";

export function declarationNodeId(id: string): string {
  return JSON.stringify(["package", id]);
}

function declarationScopeId(id: string, scope: string): string {
  return JSON.stringify(["scope", id, scope]);
}

/** Manifest requests are independent observations, including when Cargo reports no resolve graph. */
export function addManifestDeclarations(
  manifestDeclarations: CargoObservation,
  packagesById: Map<string, CargoRecord>,
  projects: Map<string, ProjectReference>,
  options: CargoObservationOptions,
): void {
  for (const [id, nativePackage] of packagesById) {
    const declarations =
      nativePackage.dependencies === undefined
        ? undefined
        : array(nativePackage.dependencies).map(record);
    if (!declarations) {
      const project = projects.get(id);
      if (project) {
        manifestDeclarations.rootCompleteness = "partial";
        const rootId = declarationScopeId(id, "cargo:unreported-declarations");
        manifestDeclarations.nodes.set(rootId, {
          id: rootId,
          purl: project.purl,
          project,
          dependencyCompleteness: "unknown",
          evidence: [options.evidenceFile],
        });
        manifestDeclarations.root(project, "cargo:unreported-declarations", rootId);
      }
      continue;
    }

    for (const declaration of declarations) {
      const request = requestFromDeclaration(declaration);
      const condition = declarationActivation(declaration);
      const kind = cargoKind(declaration.kind);
      const edge = {
        from: declarationNodeId(id),
        status: "declared" as const,
        relation: "depends-on" as const,
        kind,
        requested: request,
        ...(readOptionalFlag(declaration) !== undefined && {
          optional: readOptionalFlag(declaration),
        }),
        evidence: [options.evidenceFile],
        attributes: { "cargo:declaration": json(declaration) },
        ...(condition
          ? { selection: "conditional" as const, condition }
          : { selection: "selected" as const }),
      };
      manifestDeclarations.edges.push(edge);

      const project = projects.get(id);
      if (project) {
        const rootId = declarationScopeId(id, kind);
        if (!manifestDeclarations.nodes.has(rootId)) {
          manifestDeclarations.nodes.set(rootId, {
            id: rootId,
            purl: project.purl,
            project,
            dependencyCompleteness: "complete",
            evidence: [options.evidenceFile],
          });
          manifestDeclarations.root(project, kind, rootId);
        }
        manifestDeclarations.edges.push({ ...edge, from: rootId });
      }
    }

    // Known-empty scopes still establish complete declaration roots.
    const project = projects.get(id);
    if (project)
      for (const kind of ["dependencies", "dev-dependencies", "build-dependencies"]) {
        const rootId = declarationScopeId(id, kind);
        if (manifestDeclarations.nodes.has(rootId)) continue;
        manifestDeclarations.nodes.set(rootId, {
          id: rootId,
          purl: project.purl,
          project,
          dependencyCompleteness: "complete",
          evidence: [options.evidenceFile],
        });
        manifestDeclarations.root(project, kind, rootId);
      }
  }
}

export function findMatchingDeclarations(
  owner: CargoRecord | undefined,
  target: CargoRecord | undefined,
  resolutionDependency: CargoRecord,
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

    // Cargo extern names can come from an explicit rename or a library target's own name.
    let names: string[];
    if (typeof declaration.rename === "string") {
      names = [declaration.rename];
    } else if (Array.isArray(target.targets)) {
      names = target.targets
        .map(record)
        .filter(
          (entry) =>
            Array.isArray(entry.kind) &&
            entry.kind.some((value) =>
              ["lib", "rlib", "dylib", "staticlib", "cdylib", "proc-macro"].includes(String(value)),
            ),
        )
        .map((entry) => text(entry.name));
    } else {
      names = [text(target.name)];
    }

    return names.some(
      (name) => name.replaceAll("-", "_") === (kind.extern_name ?? resolutionDependency.name),
    );
  });
}

export function requestFromDeclaration(declaration: CargoRecord): DependencyRequest {
  return {
    name: typeof declaration.rename === "string" ? declaration.rename : text(declaration.name),
    specifier: text(declaration.req),
    ...(declaration.features !== undefined && { features: strings(declaration.features) }),
    ...(targetCondition(declaration.target) && { condition: targetCondition(declaration.target) }),
    attributes: { "cargo:declaration": json(declaration) },
  };
}

export function readOptionalFlag(value: CargoRecord): boolean | undefined {
  if (value.optional !== undefined && typeof value.optional !== "boolean")
    throw new Error("Invalid Cargo optional flag");
  return value.optional as boolean | undefined;
}

export function targetCondition(value: unknown): DependencyCondition | undefined {
  return value === null || value === undefined
    ? undefined
    : {
        language: "cargo:target-predicate/v1",
        expression: text(value),
        environment: "cargo:declaring-compilation-unit",
      };
}

function declarationActivation(value: CargoRecord): DependencyCondition | undefined {
  const optionalDependency =
    readOptionalFlag(value) === true
      ? typeof value.rename === "string"
        ? value.rename
        : text(value.name)
      : undefined;

  if (value.target === null || value.target === undefined) {
    if (optionalDependency === undefined) return undefined;
    return {
      language: "cargo:manifest-activation/v1",
      expression: { optionalDependency },
      environment: "cargo:declaring-compilation-unit",
    };
  }

  return {
    language: "cargo:manifest-activation/v1",
    expression: {
      target: text(value.target),
      ...(optionalDependency && { optionalDependency }),
    },
    environment: "cargo:declaring-compilation-unit",
  };
}
