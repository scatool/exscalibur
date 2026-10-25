import { dirname, join, normalize, relative } from "node:path/posix";
import { satisfies, valid, validRange } from "semver";
import {
  mergeResultsV2,
  readNormalizedTextFile,
  scanFiles,
  type AnalyzerResultV2,
  type DependencyCondition,
  type FileExtractionContextV2,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "./npm-utils.ts";
import {
  NpmGraphV2,
  addCurrentManifestObservation,
  dependencyScopes,
  json,
  loadNpmManifest,
  table,
  type NpmDeclaration,
  type NpmProject,
  type NpmRecord,
} from "./npm-v2.ts";
import type { JavaScriptOptions } from "./options.ts";
import { parseYarnLock, parseYarnDescriptor, yarnRecord, type YarnLockEntry } from "./yarn-lock.ts";

type WorkspaceManifest = {
  location: string;
  definition: string;
  manifest: NpmRecord;
  available: boolean;
  declarationsKnown: boolean;
  entry?: YarnLockEntry;
};

/** Keep native locked topology and current-manifest scope correlation as separate observations. */
export async function extractYarnV2(
  file: string,
  options: JavaScriptOptions,
  context: FileExtractionContextV2,
  modern: boolean,
): Promise<AnalyzerResultV2> {
  const content = await readNormalizedTextFile(file);
  const { entries, metadata } = parseYarnLock(content, modern);
  const name = modern ? "yarnberry" : "yarnlock";
  const nativeLock = new NpmGraphV2(context, name);
  nativeLock.attributes["yarn:observation"] = "native-lock";
  nativeLock.attributes["yarn:metadata"] = json(metadata);
  nativeLock.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";
  nativeLock.result.issues.push({
    code: "yarn.raw_lock_projection",
    severity: "HINT",
    file: context.relativeFile,
    message:
      "Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed",
  });

  // Manifest discovery is separate from lock parsing and may fail without losing native evidence.
  const manifests = new Map<string, WorkspaceManifest>();
  const loadWorkspaceManifest = async (location: string, entry?: YarnLockEntry) => {
    const loaded = await loadNpmManifest(
      join(dirname(file), location, "package.json"),
      entry ? { name: entry.name } : {},
      nativeLock,
    );
    const definition = loaded.available
      ? join(dirname(context.relativeFile), location, "package.json")
      : `${context.relativeFile}#workspace=${encodeURIComponent(location)}`;
    const manifest = {
      location,
      definition,
      ...loaded,
      declarationsKnown: loaded.available,
      ...(entry && { entry }),
    };
    manifests.set(location, manifest);
    if (loaded.available) nativeLock.sourceFiles.add(definition);
    return manifest;
  };

  if (modern) {
    for (const entry of entries)
      if (entry.workspace !== undefined) await loadWorkspaceManifest(entry.workspace, entry);
  }
  if (!manifests.has(".")) await loadWorkspaceManifest(".");

  let workspaceDiscoveryFailed = false;
  if (!modern) {
    try {
      const root = manifests.get(".")!.manifest;
      const workspaces = Array.isArray(root.workspaces)
        ? root.workspaces
        : table(root, "workspaces").packages;
      if (workspaces !== undefined && !Array.isArray(workspaces))
        throw new Error("Expected Yarn workspace patterns");
      for (const pattern of workspaces ?? []) {
        if (typeof pattern !== "string")
          throw new Error("Expected a string Yarn workspace pattern");
        for (const manifest of await scanFiles(
          dirname(file),
          `${pattern}/package.json`,
          options.ignore,
        )) {
          const location = normalize(relative(dirname(file), dirname(manifest)));
          if (!manifests.has(location)) await loadWorkspaceManifest(location);
        }
      }
    } catch (error) {
      workspaceDiscoveryFailed = true;
      nativeLock.result.issues.push({
        code: "yarn.workspace_declarations_failed",
        severity: "WARNING",
        file: manifests.get(".")!.definition,
        message: `Could not discover current workspaces; native lock evidence is retained: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const currentDeclarations = new NpmGraphV2(context, "packagejson", "declared");
  currentDeclarations.sourceFiles.clear();
  if (workspaceDiscoveryFailed) currentDeclarations.rootCompleteness = "partial";
  for (const manifest of manifests.values())
    if (manifest.available)
      manifest.declarationsKnown = addCurrentManifestObservation(
        currentDeclarations,
        manifest.location,
        manifest.definition,
        manifest.manifest,
        () => yarnDeclarations(manifest.manifest),
      );

  const currentManifestScopes = new NpmGraphV2(context, name);
  currentManifestScopes.attributes["yarn:observation"] = "current-manifest-scopes";
  currentManifestScopes.attributes["yarn:scopeSource"] = "current-manifests";
  currentManifestScopes.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";
  for (const builder of [nativeLock, currentManifestScopes]) {
    builder.attributes["yarn:projection"] = "raw-descriptor-map";
    builder.attributes["yarn:effectiveResolution"] = "not-observed";
    builder.attributes["yarn:resolverTransformations"] = "not-applied";
  }
  if (!modern || !entries.some((entry) => entry.workspace !== undefined))
    nativeLock.rootCompleteness = "unknown";
  if (
    workspaceDiscoveryFailed ||
    [...manifests.values()].some((manifest) => !manifest.declarationsKnown)
  )
    currentManifestScopes.rootCompleteness = "partial";

  // Each observation gets its own view indexes; equal packages do not merge their contexts.
  const populateObservation = (builder: NpmGraphV2, correlateCurrentManifests: boolean) => {
    // Register views and descriptor indexes before looking up any dependency.
    const targets = new Map<string, string>();
    const descriptors = new Map<string, YarnLockEntry>();
    const projects = new Map<string, NpmProject>();
    const workspaces = new Map<string, WorkspaceManifest[]>();
    const targetVersions = new Map<string, string>();

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
        projects.set(manifest.location, project);
        if (typeof manifest.manifest.version === "string")
          targetVersions.set(project.consumer, manifest.manifest.version);
        if (manifest.available) builder.sourceFiles.add(manifest.definition);
      }
      const workspaceName = manifest.manifest.name;
      if (typeof workspaceName === "string")
        workspaces.set(workspaceName, [...(workspaces.get(workspaceName) ?? []), manifest]);
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
          if (descriptors.has(alias) && descriptors.get(alias) !== entry)
            throw new Error(`Conflicting Yarn descriptor: ${alias}`);
          descriptors.set(alias, entry);
        }
      }
      let id: string;
      const workspace = entry.workspace === undefined ? undefined : projects.get(entry.workspace);
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
      targets.set(entry.locator, id);
      if (
        typeof entry.metadata.version === "string" &&
        entry.metadata.version !== "0.0.0-use.local"
      )
        targetVersions.set(id, entry.metadata.version);
    }

    const lookupLockEntry = (
      dependencyName: string,
      reference: string,
    ): YarnLockEntry | undefined => {
      const candidates = [`${dependencyName}@${reference}`];
      if (modern && implicitNpmReference(reference))
        candidates.push(`${dependencyName}@npm:${reference}`);
      const found = candidates.flatMap((descriptor) =>
        descriptors.has(descriptor) ? [descriptors.get(descriptor)!] : [],
      );
      if (new Set(found.map((entry) => entry.locator)).size > 1)
        throw new Error(`Ambiguous Yarn descriptor: ${dependencyName}@${reference}`);
      return found[0];
    };

    const findClassicWorkspace = (
      dependencyName: string,
      reference: string,
    ): WorkspaceManifest | undefined => {
      if (modern) return undefined;
      const candidates = (workspaces.get(dependencyName) ?? []).filter(
        (manifest) =>
          typeof manifest.manifest.version === "string" &&
          valid(manifest.manifest.version) !== null &&
          validRange(reference) !== null &&
          satisfies(manifest.manifest.version, reference),
      );
      if (candidates.length > 1)
        throw new Error(`Ambiguous Yarn workspace name: ${dependencyName}`);
      return candidates[0];
    };

    const resolveTarget = (dependencyName: string, reference: string): string | undefined => {
      const workspace = correlateCurrentManifests
        ? findClassicWorkspace(dependencyName, reference)
        : undefined;
      if (workspace) return projects.get(workspace.location)?.consumer;
      const entry = lookupLockEntry(dependencyName, reference);
      return entry ? targets.get(entry.locator) : undefined;
    };

    const targetCondition = (target: string | undefined): DependencyCondition | undefined => {
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
    };

    const addDependency = (
      from: string,
      dependencyName: string,
      reference: string,
      kind: string,
      target: string | undefined,
      selection: "selected" | "unknown" | "excluded",
      optional: boolean | undefined,
      status?: "declared",
    ) =>
      builder.dependency(from, dependencyName, reference, kind, target, {
        selection,
        optional,
        ...(status && { status }),
        ...(targetCondition(target) && { condition: targetCondition(target) }),
        attributes: { "yarn:descriptor": `${dependencyName}@${reference}` },
      });

    const addNativeDependencies = (entry: YarnLockEntry, from: string) => {
      for (const scope of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [dependencyName, value] of Object.entries(table(entry.metadata, scope))) {
          if (typeof value !== "string")
            throw new Error(`Invalid Yarn ${scope} request for '${dependencyName}'`);
          const peer = scope === "peerDependencies";
          const target = peer ? undefined : resolveTarget(dependencyName, value);
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
              target === undefined ? undefined : targetVersions.get(target),
            );
          }

          // Lockfiles omit virtual peer instances; an unbound optional peer is not proof of absence.
          addDependency(
            from,
            dependencyName,
            value,
            peer ? scope : entry.workspace !== undefined ? "yarn:dependencies" : scope,
            target,
            peer || (optional && target === undefined) ? "unknown" : "selected",
            optional,
            peer || (optional && target === undefined) ? "declared" : undefined,
          );
        }
      }
    };

    // Native records supply topology independently of current manifest scope assignments.
    for (const entry of entries) {
      if (correlateCurrentManifests && entry.workspace !== undefined) continue;
      const from = targets.get(entry.locator)!;
      addNativeDependencies(entry, from);
      if (entry.workspace !== undefined) {
        const project = projects.get(entry.workspace)!;
        const root = builder.addRoot(project, "yarn:dependencies");
        addNativeDependencies(entry, root);
      }
    }

    if (!correlateCurrentManifests) return;

    // Correlation can add scope roots, but unmatched requests remain explicitly uncertain.
    for (const manifest of manifests.values()) {
      const project = projects.get(manifest.location)!;
      if (manifest.available && !manifest.declarationsKnown) {
        for (const scope of NPM_DEPENDENCY_SCOPES) builder.addRoot(project, scope);
        continue;
      }
      const declarations = yarnDeclarations(manifest.manifest, (name, reference) => {
        const target = resolveTarget(name, reference);
        return target === undefined ? undefined : targetVersions.get(target);
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
          const target = peer ? undefined : resolveTarget(declaration.name, declaration.specifier);
          const nativeReference = nativeRequests[declaration.name];
          const correlated =
            !peer &&
            typeof nativeReference === "string" &&
            lookupLockEntry(declaration.name, nativeReference)?.locator ===
              lookupLockEntry(declaration.name, declaration.specifier)?.locator &&
            equivalentRequest(declaration.name, nativeReference, declaration.specifier);
          if (modern && !peer && !correlated) drift = true;
          const selection = declaration.excluded ? "excluded" : correlated ? "selected" : "unknown";
          const status = target === undefined || peer ? "declared" : undefined;
          addDependency(
            root,
            declaration.name,
            declaration.specifier,
            scope,
            target,
            selection,
            declaration.optional,
            status,
          );
          addDependency(
            project.consumer,
            declaration.name,
            declaration.specifier,
            scope,
            target,
            declaration.excluded || scope === "devDependencies" ? "excluded" : selection,
            declaration.optional,
            status,
          );
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
  };

  populateObservation(nativeLock, false);
  populateObservation(currentManifestScopes, true);

  return mergeResultsV2([
    nativeLock.finish(),
    currentManifestScopes.finish(),
    ...(currentDeclarations.result.subprojects.length > 0 ? [currentDeclarations.finish()] : []),
  ]);
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

function yarnDeclarations(
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
