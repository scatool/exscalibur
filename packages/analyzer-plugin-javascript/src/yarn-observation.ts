import { satisfies, valid, validRange } from "semver";
import type { DependencyCondition } from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "./npm-utils.ts";
import {
  NpmGraphV2,
  dependencyScopes,
  json,
  table,
  type NpmDeclaration,
  type NpmProject,
  type NpmRecord,
} from "./npm-v2.ts";
import { parseYarnDescriptor, yarnRecord, type YarnLockEntry } from "./yarn-lock.ts";

export type WorkspaceManifest = {
  location: string;
  definition: string;
  manifest: NpmRecord;
  available: boolean;
  declarationsKnown: boolean;
  entry?: YarnLockEntry;
};

type ProjectionInput = {
  entries: YarnLockEntry[];
  metadata: NpmRecord;
  manifests: Map<string, WorkspaceManifest>;
  modern: boolean;
  correlateCurrentManifests: boolean;
};

/** Each projection owns its indexes: equal packages never pool adjacency across observations. */
export class YarnObservationProjection {
  private readonly targetByLocator = new Map<string, string>();
  private readonly entryByDescriptor = new Map<string, YarnLockEntry>();
  private readonly projectByLocation = new Map<string, NpmProject>();
  private readonly workspacesByName = new Map<string, WorkspaceManifest[]>();
  private readonly versionByTarget = new Map<string, string>();

  constructor(
    private readonly builder: NpmGraphV2,
    private readonly input: ProjectionInput,
  ) {}

  populate(): void {
    // Resolve references only after every native view and descriptor has been registered.
    this.registerViews();
    this.addNativeTopology();

    if (this.input.correlateCurrentManifests) this.addCurrentManifestScopes();
  }

  private registerViews(): void {
    const {
      builder,
      targetByLocator,
      entryByDescriptor,
      projectByLocation,
      workspacesByName,
      versionByTarget,
    } = this;
    const { entries, manifests, metadata, modern, correlateCurrentManifests } = this.input;

    for (const manifest of manifests.values()) {
      if (correlateCurrentManifests || manifest.entry) {
        const project = builder.addProject(
          manifest.location,
          manifest.definition,
          manifest.manifest,
          correlateCurrentManifests ? manifest.declarationsKnown : true,
        );
        builder.nodes.get(project.consumer)!.attributes!["yarn:coordinateSource"] =
          manifest.available ? "current-manifest" : "lock-locator";
        projectByLocation.set(manifest.location, project);
        if (typeof manifest.manifest.version === "string")
          versionByTarget.set(project.consumer, manifest.manifest.version);
        if (manifest.available) builder.sourceFiles.add(manifest.definition);
      }

      const workspaceName = manifest.manifest.name;
      if (typeof workspaceName === "string")
        workspacesByName.set(workspaceName, [
          ...(workspacesByName.get(workspaceName) ?? []),
          manifest,
        ]);
    }

    for (const entry of entries) {
      for (const pattern of entry.patterns) {
        const aliases = [pattern];
        if (modern && Number(metadata.version) <= 6) {
          const parsed = parseYarnDescriptor(pattern);
          if (implicitNpmReference(parsed.reference))
            aliases.push(`${parsed.name}@npm:${parsed.reference}`);
        }

        for (const alias of aliases) {
          if (entryByDescriptor.has(alias) && entryByDescriptor.get(alias) !== entry)
            throw new Error(`Conflicting Yarn descriptor: ${alias}`);
          entryByDescriptor.set(alias, entry);
        }
      }

      let id: string;
      const workspace =
        entry.workspace === undefined ? undefined : projectByLocation.get(entry.workspace);
      if (workspace) id = workspace.consumer;
      else {
        id = builder.addPackage(
          `resolution:${JSON.stringify(entry.locator)}`,
          entry.name,
          {
            ...entry.metadata,
            name: entry.name,
            version: entry.metadata.version === "0.0.0-use.local" ? "" : entry.metadata.version,
          },
          modern,
        );
      }

      const node = builder.nodes.get(id)!;
      node.locator = entry.locator;
      node.attributes!["yarn:record"] = json(entry.metadata);
      node.attributes!["yarn:descriptors"] = entry.patterns;
      if (entry.metadata.conditions !== undefined)
        node.attributes!["yarn:conditions"] = json(entry.metadata.conditions);
      targetByLocator.set(entry.locator, id);
      if (
        typeof entry.metadata.version === "string" &&
        entry.metadata.version !== "0.0.0-use.local"
      )
        versionByTarget.set(id, entry.metadata.version);
    }
  }

  private lookupLockEntry(dependencyName: string, reference: string): YarnLockEntry | undefined {
    const { modern } = this.input;
    const { entryByDescriptor } = this;

    const candidates = [`${dependencyName}@${reference}`];
    if (modern && implicitNpmReference(reference))
      candidates.push(`${dependencyName}@npm:${reference}`);

    const found = candidates.flatMap((descriptor) =>
      entryByDescriptor.has(descriptor) ? [entryByDescriptor.get(descriptor)!] : [],
    );
    if (new Set(found.map((entry) => entry.locator)).size > 1)
      throw new Error(`Ambiguous Yarn descriptor: ${dependencyName}@${reference}`);

    return found[0];
  }

  private findClassicWorkspace(
    dependencyName: string,
    reference: string,
  ): WorkspaceManifest | undefined {
    const { modern } = this.input;
    const { workspacesByName } = this;

    if (modern) return undefined;

    const candidates = (workspacesByName.get(dependencyName) ?? []).filter(
      (manifest) =>
        typeof manifest.manifest.version === "string" &&
        valid(manifest.manifest.version) !== null &&
        validRange(reference) !== null &&
        satisfies(manifest.manifest.version, reference),
    );
    if (candidates.length > 1) throw new Error(`Ambiguous Yarn workspace name: ${dependencyName}`);

    return candidates[0];
  }

  private resolveTarget(dependencyName: string, reference: string): string | undefined {
    const { correlateCurrentManifests } = this.input;
    const { projectByLocation, targetByLocator } = this;

    const workspace = correlateCurrentManifests
      ? this.findClassicWorkspace(dependencyName, reference)
      : undefined;
    if (workspace) return projectByLocation.get(workspace.location)?.consumer;

    const entry = this.lookupLockEntry(dependencyName, reference);
    return entry ? targetByLocator.get(entry.locator) : undefined;
  }

  private targetCondition(target: string | undefined): DependencyCondition | undefined {
    const { builder } = this;

    const node = target ? builder.nodes.get(target) : undefined;
    const nativeConditions = node?.attributes?.["yarn:conditions"];
    const platform = node?.attributes?.["npm:platform"];

    return nativeConditions === undefined
      ? undefined
      : {
          language: "yarn:applicability/v1",
          expression: {
            conditions: nativeConditions,
            ...(platform !== undefined && { platform }),
          },
        };
  }

  private addDependency(
    from: string,
    dependencyName: string,
    reference: string,
    kind: string,
    binding: {
      target: string | undefined;
      selection: "selected" | "unknown" | "excluded";
      optional: boolean | undefined;
      status?: "declared";
    },
  ) {
    const { builder } = this;
    const { target, selection, optional, status } = binding;

    return builder.dependency(from, dependencyName, reference, kind, target, {
      selection,
      optional,
      ...(status && { status }),
      ...(this.targetCondition(target) && { condition: this.targetCondition(target) }),
      attributes: { "yarn:descriptor": `${dependencyName}@${reference}` },
    });
  }

  private addNativeDependencies(entry: YarnLockEntry, from: string) {
    const { versionByTarget } = this;

    for (const scope of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, value] of Object.entries(table(entry.metadata, scope))) {
        if (typeof value !== "string")
          throw new Error(`Invalid Yarn ${scope} request for '${dependencyName}'`);

        const peer = scope === "peerDependencies";
        const target = peer ? undefined : this.resolveTarget(dependencyName, value);
        let optional: boolean | undefined;
        if (scope === "optionalDependencies") {
          optional = true;
        } else if (peer) {
          optional =
            optionalFlag(
              table(table(entry.metadata, "peerDependenciesMeta"), dependencyName).optional,
            ) === true;
        } else {
          optional = dependencyOptional(
            entry.metadata,
            dependencyName,
            target === undefined ? undefined : versionByTarget.get(target),
          );
        }

        // Lockfiles omit virtual peer instances; an unbound optional peer is not proof of absence.
        this.addDependency(
          from,
          dependencyName,
          value,
          peer ? scope : entry.workspace !== undefined ? "yarn:dependencies" : scope,
          {
            target,
            selection: peer || (optional && target === undefined) ? "unknown" : "selected",
            optional,
            status: peer || (optional && target === undefined) ? "declared" : undefined,
          },
        );
      }
    }
  }

  private addNativeTopology(): void {
    const { builder, targetByLocator, projectByLocation } = this;
    const { entries, correlateCurrentManifests } = this.input;

    // Native records supply topology independently of current manifest scope assignments.
    for (const entry of entries) {
      if (correlateCurrentManifests && entry.workspace !== undefined) continue;

      const from = targetByLocator.get(entry.locator)!;
      this.addNativeDependencies(entry, from);

      if (entry.workspace !== undefined) {
        const project = projectByLocation.get(entry.workspace)!;
        const root = builder.addRoot(project, "yarn:dependencies");
        this.addNativeDependencies(entry, root);
      }
    }
  }

  private addCurrentManifestScopes(): void {
    const { builder, projectByLocation, versionByTarget } = this;
    const { manifests, modern } = this.input;

    // Correlation can add scope roots, but unmatched requests remain explicitly uncertain.
    for (const manifest of manifests.values()) {
      const project = projectByLocation.get(manifest.location)!;
      if (manifest.available && !manifest.declarationsKnown) {
        for (const scope of NPM_DEPENDENCY_SCOPES) builder.addRoot(project, scope);
        continue;
      }

      const declarations = yarnDeclarations(manifest.manifest, (name, reference) => {
        const target = this.resolveTarget(name, reference);
        return target === undefined ? undefined : versionByTarget.get(target);
      });

      const nativeRequests = manifest.entry ? table(manifest.entry.metadata, "dependencies") : {};
      let drift = Object.entries(nativeRequests).some(
        ([name, reference]) =>
          typeof reference !== "string" ||
          !declarations.some(
            (declaration) =>
              !declaration.excluded &&
              declaration.scope !== "peerDependencies" &&
              declaration.name === name &&
              equivalentRequest(name, reference, declaration.specifier),
          ),
      );

      for (const scope of NPM_DEPENDENCY_SCOPES) {
        const root = builder.addRoot(project, scope);
        for (const declaration of declarations.filter((item) => item.scope === scope)) {
          const peer = scope === "peerDependencies";
          const target = peer
            ? undefined
            : this.resolveTarget(declaration.name, declaration.specifier);
          const nativeReference = nativeRequests[declaration.name];
          const correlated =
            !peer &&
            typeof nativeReference === "string" &&
            this.lookupLockEntry(declaration.name, nativeReference)?.locator ===
              this.lookupLockEntry(declaration.name, declaration.specifier)?.locator &&
            equivalentRequest(declaration.name, nativeReference, declaration.specifier);
          if (modern && !peer && !correlated) drift = true;

          const selection = declaration.excluded ? "excluded" : correlated ? "selected" : "unknown";
          const status = target === undefined || peer ? "declared" : undefined;
          this.addDependency(root, declaration.name, declaration.specifier, scope, {
            target,
            selection,
            optional: declaration.optional,
            status,
          });
          this.addDependency(project.consumer, declaration.name, declaration.specifier, scope, {
            target,
            selection: declaration.excluded || scope === "devDependencies" ? "excluded" : selection,
            optional: declaration.optional,
            status,
          });
        }
      }

      if (modern && drift)
        builder.result.issues.push({
          code: "yarn.manifest_lock_mismatch",
          severity: "WARNING",
          file: manifest.definition,
          message:
            "Current manifest requests do not match the workspace lock declarations; unmatched bindings remain unknown and the native lock observation is retained separately",
        });

      if (modern && drift && manifest.available) {
        // This observation projects only current declarations. Original lock-only bindings live
        // in the native graph; their disagreement prevents a complete correlated closure claim.
        builder.nodes.get(project.consumer)!.dependencyCompleteness = "partial";
        for (const root of builder.roots.filter(
          (root) => root.project.definitionFile === project.reference.definitionFile,
        ))
          builder.nodes.get(root.node)!.dependencyCompleteness = "partial";
      }

      if (!manifest.available)
        builder.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";
    }
  }
}

function implicitNpmReference(reference: string): boolean {
  // Yarn normalizes semver ranges and tag-shaped references to its npm default protocol.
  // Retain encoded patch descriptors verbatim: no unverified patch rewrite is applied.
  return validRange(reference) !== null || /^(?!v)[a-z0-9._-]+$/i.test(reference);
}

function equivalentRequest(name: string, a: string, b: string): boolean {
  const normalized = (value: string) =>
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ? `${name}@${value}` : `${name}@npm:${value}`;
  return normalized(a) === normalized(b);
}

export function yarnDeclarations(
  manifest: NpmRecord,
  version?: (name: string, reference: string) => string | undefined,
): NpmDeclaration[] {
  return dependencyScopes(manifest).map((declaration) =>
    declaration.scope === "dependencies" || declaration.scope === "devDependencies"
      ? {
          ...declaration,
          optional: dependencyOptional(
            manifest,
            declaration.name,
            version?.(declaration.name, declaration.specifier),
          ),
        }
      : declaration,
  );
}

function dependencyOptional(
  metadata: NpmRecord,
  name: string,
  version?: string,
): boolean | undefined {
  const meta = table(metadata, "dependenciesMeta");
  const base = optionalFlag(table(meta, name).optional) === true;
  let optional: boolean | undefined = base;
  for (const [key, value] of Object.entries(meta)) {
    if (!key.startsWith(`${name}@`)) continue;
    const selector = valid(key.slice(name.length + 1));
    if (selector === null) throw new Error(`Invalid Yarn dependency metadata version: ${key}`);
    const setting = optionalFlag(yarnRecord(value).optional);
    if (setting === undefined) continue;
    if (version === undefined) {
      if (setting !== base) optional = undefined;
    } else if (valid(version) === selector) optional = setting;
  }
  return optional;
}

function optionalFlag(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid Yarn optional metadata flag");
}
