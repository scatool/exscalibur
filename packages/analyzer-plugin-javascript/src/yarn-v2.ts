import { dirname, join, normalize, relative } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { satisfies, valid, validRange } from "semver";
import { parse as parseYaml } from "yaml";
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
  addManifestObservation,
  dependencyScopes,
  json,
  loadNpmManifest,
  table,
  type NpmDeclaration,
  type NpmProject,
  type NpmRecord,
} from "./npm-v2.ts";

// Load the CommonJS parser consistently in Node and transformed test modules.
const { parse: parseClassicLock } = createRequire(import.meta.url)(
  "@yarnpkg/lockfile",
) as typeof import("@yarnpkg/lockfile");
import type { JavaScriptOptions } from "./options.ts";

type Entry = {
  key: string;
  patterns: string[];
  locator: string;
  name: string;
  metadata: NpmRecord;
  workspace?: string;
};
type Manifest = {
  location: string;
  definition: string;
  manifest: NpmRecord;
  available: boolean;
  entry?: Entry;
};

/** Keep native locked topology and current-manifest scope correlation as separate observations. */
export async function extractYarnV2(
  file: string,
  options: JavaScriptOptions,
  context: FileExtractionContextV2,
  modern: boolean,
): Promise<AnalyzerResultV2> {
  const content = await readNormalizedTextFile(file);
  const { entries, metadata } = parseEntries(content, modern);
  const name = modern ? "yarnberry" : "yarnlock";
  const native = new NpmGraphV2(context, name);
  native.attributes["yarn:observation"] = "native-lock";
  native.attributes["yarn:metadata"] = json(metadata);
  native.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";
  native.result.issues.push({
    code: "yarn.raw_lock_projection",
    severity: "HINT",
    file: context.relativeFile,
    message:
      "Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed",
  });
  const manifests = new Map<string, Manifest>();
  const load = async (location: string, entry?: Entry) => {
    const loaded = await loadNpmManifest(
      join(dirname(file), location, "package.json"),
      entry ? { name: entry.name } : {},
      native,
    );
    const definition = loaded.available
      ? join(dirname(context.relativeFile), location, "package.json")
      : `${context.relativeFile}#workspace=${encodeURIComponent(location)}`;
    const manifest = { location, definition, ...loaded, ...(entry && { entry }) };
    manifests.set(location, manifest);
    if (loaded.available) native.sourceFiles.add(definition);
    return manifest;
  };
  if (modern) {
    for (const entry of entries)
      if (entry.workspace !== undefined) await load(entry.workspace, entry);
  }
  if (!manifests.has(".")) await load(".");
  if (!modern) {
    const root = manifests.get(".")!.manifest;
    const workspaces = Array.isArray(root.workspaces)
      ? root.workspaces
      : table(root, "workspaces").packages;
    if (workspaces !== undefined && !Array.isArray(workspaces))
      throw new Error("Expected Yarn workspace patterns");
    for (const pattern of workspaces ?? []) {
      if (typeof pattern !== "string") throw new Error("Expected a string Yarn workspace pattern");
      for (const manifest of await scanFiles(
        dirname(file),
        `${pattern}/package.json`,
        options.ignore,
      )) {
        const location = normalize(relative(dirname(file), dirname(manifest)));
        if (!manifests.has(location)) await load(location);
      }
    }
  }
  const declared = new NpmGraphV2(context, "packagejson", "declared");
  declared.sourceFiles.clear();
  for (const manifest of manifests.values())
    if (manifest.available)
      addManifestObservation(
        declared,
        manifest.location,
        manifest.definition,
        manifest.manifest,
        yarnDeclarations(manifest.manifest),
      );
  const scoped = new NpmGraphV2(context, name);
  scoped.attributes["yarn:observation"] = "current-manifest-scopes";
  scoped.attributes["yarn:scopeSource"] = "current-manifests";
  scoped.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";
  for (const builder of [native, scoped]) {
    builder.attributes["yarn:projection"] = "raw-descriptor-map";
    builder.attributes["yarn:effectiveResolution"] = "not-observed";
    builder.attributes["yarn:resolverTransformations"] = "not-applied";
  }
  if (!modern || !entries.some((entry) => entry.workspace !== undefined))
    native.rootCompleteness = "unknown";
  if ([...manifests.values()].some((manifest) => !manifest.available))
    scoped.rootCompleteness = "partial";

  const populate = (builder: NpmGraphV2, correlate: boolean) => {
    const targets = new Map<string, string>();
    const descriptors = new Map<string, Entry>();
    const projects = new Map<string, NpmProject>();
    const workspaces = new Map<string, Manifest[]>();
    const targetVersions = new Map<string, string>();
    for (const manifest of manifests.values()) {
      if (correlate || manifest.entry) {
        const project = builder.addProject(
          manifest.location,
          manifest.definition,
          manifest.manifest,
          correlate ? manifest.available : true,
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
          const parsed = descriptor(pattern);
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
    const lookup = (dependencyName: string, reference: string): Entry | undefined => {
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
    const workspaceCandidate = (
      dependencyName: string,
      reference: string,
    ): Manifest | undefined => {
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
    const binding = (dependencyName: string, reference: string): string | undefined => {
      const workspace = correlate ? workspaceCandidate(dependencyName, reference) : undefined;
      if (workspace) return projects.get(workspace.location)?.consumer;
      const entry = lookup(dependencyName, reference);
      return entry ? targets.get(entry.locator) : undefined;
    };
    const condition = (target: string | undefined): DependencyCondition | undefined => {
      const node = target ? builder.nodes.get(target) : undefined;
      const native = node?.attributes?.["yarn:conditions"];
      const platform = node?.attributes?.["npm:platform"];
      return native === undefined
        ? undefined
        : {
            language: "yarn:applicability/v1",
            expression: { conditions: native, ...(platform !== undefined && { platform }) },
          };
    };
    const add = (
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
        ...(condition(target) && { condition: condition(target) }),
        attributes: { "yarn:descriptor": `${dependencyName}@${reference}` },
      });
    const nativeDependencies = (entry: Entry, from: string) => {
      for (const scope of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [dependencyName, value] of Object.entries(table(entry.metadata, scope))) {
          if (typeof value !== "string")
            throw new Error(`Invalid Yarn ${scope} request for '${dependencyName}'`);
          const peer = scope === "peerDependencies";
          const target = peer ? undefined : binding(dependencyName, value);
          const optional =
            scope === "optionalDependencies"
              ? true
              : peer
                ? optionalFlag(
                    table(table(entry.metadata, "peerDependenciesMeta"), dependencyName).optional,
                  ) === true
                : dependencyOptional(
                    entry.metadata,
                    dependencyName,
                    target === undefined ? undefined : targetVersions.get(target),
                  );
          // Lockfiles omit virtual peer instances; an unbound optional peer is not proof of absence.
          add(
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
    for (const entry of entries) {
      if (correlate && entry.workspace !== undefined) continue;
      const from = targets.get(entry.locator)!;
      nativeDependencies(entry, from);
      if (entry.workspace !== undefined) {
        const project = projects.get(entry.workspace)!;
        const root = builder.addRoot(project, "yarn:dependencies");
        nativeDependencies(entry, root);
      }
    }
    if (!correlate) return;
    for (const manifest of manifests.values()) {
      const project = projects.get(manifest.location)!;
      const declarations = yarnDeclarations(manifest.manifest, (name, reference) => {
        const target = binding(name, reference);
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
          const target = peer ? undefined : binding(declaration.name, declaration.specifier);
          const nativeReference = nativeRequests[declaration.name];
          const correlated =
            !peer &&
            typeof nativeReference === "string" &&
            lookup(declaration.name, nativeReference)?.locator ===
              lookup(declaration.name, declaration.specifier)?.locator &&
            equivalentRequest(declaration.name, nativeReference, declaration.specifier);
          if (modern && !peer && !correlated) drift = true;
          const selection = declaration.excluded ? "excluded" : correlated ? "selected" : "unknown";
          const status = target === undefined || peer ? "declared" : undefined;
          add(
            root,
            declaration.name,
            declaration.specifier,
            scope,
            target,
            selection,
            declaration.optional,
            status,
          );
          add(
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
  populate(native, false);
  populate(scoped, true);
  return mergeResultsV2([
    native.finish(),
    scoped.finish(),
    ...(declared.result.subprojects.length > 0 ? [declared.finish()] : []),
  ]);
}

function parseEntries(content: string, modern: boolean): { entries: Entry[]; metadata: NpmRecord } {
  if (modern) {
    // Yarn's SYML reader uses the failsafe schema: unquoted ranges such as `6` or `true`
    // are strings, not YAML numbers/booleans. Metadata booleans are interpreted separately.
    const document = record(parseYaml(content, { schema: "failsafe" }));
    const metadata = table(document, "__metadata");
    const version = Number(metadata.version);
    if (!Number.isInteger(version) || version < 4 || version > 9)
      throw new Error(
        `Unsupported Yarn modern lockfile version: ${JSON.stringify(metadata.version)}`,
      );
    const locators = new Map<string, Entry>();
    for (const [key, value] of Object.entries(document)) {
      if (key === "__metadata") continue;
      const metadata = record(value);
      if (typeof metadata.resolution !== "string")
        throw new Error(`Yarn entry '${key}' is missing its resolution locator`);
      const parsed = descriptor(metadata.resolution);
      const workspace = parsed.reference.startsWith("workspace:")
        ? normalize(parsed.reference.slice(10))
        : undefined;
      if (workspace === ".." || workspace?.startsWith("../") || workspace?.startsWith("/"))
        throw new Error(`Yarn workspace is outside its lockfile directory: ${workspace}`);
      const patterns = key.split(/ *, */g);
      const previous = locators.get(metadata.resolution);
      if (previous) {
        if (!isDeepStrictEqual(previous.metadata, metadata))
          throw new Error(`Conflicting Yarn resolution metadata: ${metadata.resolution}`);
        previous.patterns.push(...patterns);
      } else
        locators.set(metadata.resolution, {
          key,
          locator: metadata.resolution,
          name: parsed.name,
          patterns,
          metadata,
          ...(workspace !== undefined && { workspace }),
        });
    }
    return { entries: [...locators.values()], metadata };
  }
  const parsed = parseClassicLock(content);
  if (parsed.type !== "success")
    throw new Error("Yarn Classic lockfile contains unresolved merge conflicts");
  const groups = new Map<object, { patterns: string[]; metadata: NpmRecord }>();
  for (const [pattern, value] of Object.entries(parsed.object)) {
    const metadata = record(value);
    const group = groups.get(value) ?? { patterns: [], metadata };
    group.patterns.push(pattern);
    groups.set(value, group);
  }
  const entries = [...groups.values()].map(({ patterns, metadata }) => {
    const parsed = descriptor(patterns[0]!);
    let name = parsed.name;
    if (parsed.reference.startsWith("npm:")) name = descriptor(parsed.reference.slice(4)).name;
    const key = [...patterns].sort().join(", ");
    return { key, patterns, metadata, name, locator: key };
  });
  return { entries, metadata: { version: 1, peerDeclarations: "not-recorded" } };
}
function descriptor(value: string): { name: string; reference: string } {
  const at = value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0);
  if (at < 1) throw new Error(`Invalid Yarn package descriptor: ${value}`);
  return { name: value.slice(0, at), reference: value.slice(at + 1) };
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
    const setting = optionalFlag(record(value).optional);
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
function record(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Yarn lockfile record");
  return value as NpmRecord;
}
