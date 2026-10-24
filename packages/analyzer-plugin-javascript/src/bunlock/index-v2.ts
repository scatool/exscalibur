import { dirname, join, normalize } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { valid } from "semver";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import {
  NpmGraphV2,
  addCurrentManifestObservation,
  dependencyScopes,
  json,
  loadNpmManifest,
  table,
  type NpmProject,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";

type Entry = {
  key: string;
  identifier: string;
  name: string;
  reference: string;
  metadata: NpmRecord;
  tuple: unknown[];
  infoComplete: boolean;
};

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "bunlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/bun.{lock,lockb}", options.ignore);
  },
  extractFile: async (file, _options, context) => {
    if (file.endsWith(".lockb"))
      throw new Error("Binary Bun lockfiles are unsupported; dependency coverage is unknown");
    const errors: ParseError[] = [];
    const document = record(
      parseJsonc(await readNormalizedTextFile(file), errors, { allowTrailingComma: true }),
    );
    if (errors.length > 0)
      throw new Error(
        `Invalid Bun JSONC lockfile: ${errors.map((error) => error.error).join(", ")}`,
      );
    if (![0, 1, 2, 3].includes(document.lockfileVersion as number))
      throw new Error(
        `Unsupported Bun lockfile version: ${JSON.stringify(document.lockfileVersion)}`,
      );
    const builder = new NpmGraphV2(context, "bunlock");
    const declared = new NpmGraphV2(context, "packagejson", "declared");
    declared.sourceFiles.clear();
    const { packages: _packages, workspaces: _workspaces, ...metadata } = document;
    builder.attributes["bun:metadata"] = json(metadata);
    builder.attributes["bun:peerBindings"] = "not-established-from-placement-alone";
    const packages = table(document, "packages");
    const entries: Entry[] = [];
    const workspaceAliases = new Map<Entry, { project: NpmProject; view: string }>();
    const targets = new Map<string, string>();
    const projects = new Map<string, { project: NpmProject; locked: boolean; caller: string }>();
    const workspaces = table(document, "workspaces");
    const addProject = async (location: string, metadata: NpmRecord, locked: boolean) => {
      if (projects.has(normalize(location)))
        throw new Error(`Duplicate Bun workspace location: ${location}`);
      const loaded = await loadNpmManifest(
        join(dirname(file), location, "package.json"),
        metadata,
        builder,
      );
      const definition = loaded.available
        ? join(dirname(context.relativeFile), location, "package.json")
        : `${context.relativeFile}#workspaces/${encodeURIComponent(location)}`;
      const identity = {
        ...metadata,
        ...(metadata.version === undefined &&
          typeof loaded.manifest.version === "string" && { version: loaded.manifest.version }),
        ...Object.fromEntries(
          ["os", "cpu", "libc"]
            .filter((key) => metadata[key] === undefined && loaded.manifest[key] !== undefined)
            .map((key) => [key, loaded.manifest[key]]),
        ),
      };
      const project = builder.addProject(
        location,
        definition,
        locked ? identity : loaded.manifest,
        locked || loaded.available,
      );
      builder.nodes.get(project.consumer)!.attributes!["bun:workspace"] = json(metadata);
      projects.set(normalize(location), { project, locked, caller: "" });
      if (loaded.available) {
        builder.sourceFiles.add(definition);
        const declarationsKnown = addCurrentManifestObservation(
          declared,
          location,
          definition,
          loaded.manifest,
        );
        if (!locked && !declarationsKnown) {
          project.known = false;
          builder.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";
        }
        if (
          locked &&
          [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta"].some(
            (key) => !isDeepStrictEqual(metadata[key] ?? {}, loaded.manifest[key] ?? {}),
          )
        )
          builder.result.issues.push({
            code: "bun.manifest_lock_mismatch",
            severity: "WARNING",
            file: definition,
            message:
              "Current manifest declarations differ from the Bun workspace lock; each observation retains its own requests",
          });
      }
    };
    for (const [location, value] of Object.entries(workspaces))
      await addProject(location, record(value), true);
    if (!projects.has(".")) {
      await addProject("", {}, false);
      builder.rootCompleteness = "unknown";
    }
    for (const [key, value] of Object.entries(packages)) {
      if (!Array.isArray(value) || typeof value[0] !== "string")
        throw new Error(`Invalid Bun package tuple at '${key}'`);
      const parsed = identifier(value[0]);
      const workspace = parsed.reference.startsWith("workspace:");
      const infoRequired =
        parsed.reference !== "root:" && (!workspace || document.lockfileVersion === 0);
      const info = value[valid(parsed.reference) !== null ? 2 : 1];
      const infoObject = info !== null && typeof info === "object" && !Array.isArray(info);
      const metadata = infoObject ? record(info) : {};
      const infoComplete = !infoRequired || infoObject;
      if (!infoComplete)
        builder.result.issues.push({
          code: "bun.invalid_package_info",
          severity: "WARNING",
          file: context.relativeFile,
          message: `Package '${key}' has missing or invalid native INFO; dependency coverage remains unknown`,
        });
      const entry = { key, identifier: value[0], ...parsed, metadata, tuple: value, infoComplete };
      entries.push(entry);
      if (parsed.reference.startsWith("workspace:") || parsed.reference === "root:") {
        const project = projects.get(
          parsed.reference === "root:" ? "." : normalize(parsed.reference.slice(10)),
        );
        if (!project) throw new Error(`Bun workspace package '${key}' has no workspace record`);
        const id = `workspace-alias:${JSON.stringify(key)}`;
        builder.nodes.set(id, {
          ...structuredClone(builder.nodes.get(project.project.consumer)!),
          id,
          locator: key,
          ...(!infoComplete && { dependencyCompleteness: "unknown" as const }),
          attributes: {
            ...builder.nodes.get(project.project.consumer)!.attributes,
            "bun:tuple": json(value),
          },
        });
        workspaceAliases.set(entry, { project: project.project, view: id });
        targets.set(key, id);
      } else {
        const npm = valid(parsed.reference) !== null;
        const git = /^(?:git\+|git:|github:|gitlab:)/.test(parsed.reference);
        const tarball =
          /^https?:/.test(parsed.reference) ||
          /^file:.*\.(?:tgz|tar(?:\.gz)?)(?:[?#]|$)/.test(parsed.reference);
        const integrity = value[npm || git ? 3 : tarball ? 2 : -1];
        const location =
          npm && typeof value[1] === "string" && value[1]
            ? value[1]
            : tarball
              ? parsed.reference
              : undefined;
        const version = npm
          ? parsed.reference
          : typeof metadata.version === "string"
            ? metadata.version
            : "";
        const id = builder.addPackage(
          `package:${JSON.stringify(key)}`,
          parsed.name,
          {
            ...metadata,
            version,
            ...(typeof integrity === "string" && integrity && { integrity }),
            ...(location !== undefined && { resolved: location }),
          },
          infoComplete,
        );
        builder.nodes.get(id)!.locator = key;
        builder.nodes.get(id)!.attributes!["bun:tuple"] = json(value);
        targets.set(key, id);
      }
    }
    for (const [location, item] of projects) {
      if (location === ".") continue;
      const name = item.project.manifest.name;
      const aliases = [...workspaceAliases]
        .filter(([, alias]) => alias.project === item.project)
        .map(([entry]) => entry);
      // An unlinked workspace can share its name with a registry dependency. Bun then prints
      // the workspace's private subtree under './name', rather than under the registry slot.
      item.caller =
        typeof name === "string" && aliases.some((entry) => entry.key === name)
          ? name
          : (aliases.find((entry) => entry.key.startsWith("./"))?.key ??
            (typeof name === "string" ? `./${name}` : ""));
    }
    const resolvePlacement = (caller: string, name: string): string | undefined => {
      const segments = pathSegments(caller);
      while (true) {
        const candidate = [...segments, name].join("/");
        if (targets.has(candidate)) return targets.get(candidate);
        if (segments.length === 0) return undefined;
        segments.pop();
      }
    };
    const resolve = (caller: string, name: string, specifier: string): string | undefined => {
      const placement = resolvePlacement(caller, name);
      if (
        !specifier.startsWith("workspace:") ||
        (placement && builder.nodes.get(placement)?.project)
      )
        return placement;
      const path = normalize(specifier.slice(10));
      const members = [...projects].filter(
        ([location, item]) =>
          item.project.manifest.name === name || (path !== "." && path === location),
      );
      if (members.length > 1)
        throw new Error(`Ambiguous Bun workspace reference: ${name}@${specifier}`);
      const member = members[0]?.[1].project;
      if (!member) return undefined;
      return (
        [...workspaceAliases].find(
          ([entry, alias]) => alias.project === member && entry.key.startsWith("./"),
        )?.[1].view ?? member.consumer
      );
    };
    const declarations = (
      from: string,
      metadata: NpmRecord,
      caller: string,
      consumer: boolean,
      locked: boolean,
      onlyScope?: string,
      workspace = false,
    ) => {
      const optionalPeers = new Set(strings(metadata.optionalPeers));
      const unresolved = new Set(strings(metadata.unresolved));
      for (const declaration of dependencyScopes(metadata)) {
        if (onlyScope !== undefined && declaration.scope !== onlyScope) continue;
        const peer = declaration.scope === "peerDependencies";
        const optional = declaration.optional || (peer && optionalPeers.has(declaration.name));
        const excluded =
          declaration.excluded || (consumer && declaration.scope === "devDependencies");
        const explicitlyUnresolved = unresolved.has(declaration.name);
        const strippedCatalog = !workspace && declaration.specifier.startsWith("catalog:");
        const candidate =
          explicitlyUnresolved || strippedCatalog
            ? undefined
            : resolve(caller, declaration.name, declaration.specifier);
        const selection =
          excluded || (explicitlyUnresolved && optional)
            ? "excluded"
            : peer || !locked || (optional && candidate === undefined)
              ? "unknown"
              : "selected";
        builder.dependency(
          from,
          declaration.name,
          declaration.specifier,
          declaration.scope,
          candidate,
          {
            selection,
            optional,
            ...((peer ||
              excluded ||
              explicitlyUnresolved ||
              strippedCatalog ||
              (optional && candidate === undefined)) && { status: "declared" as const }),
            attributes: {
              "bun:caller": caller,
              ...(peer && {
                "bun:peerBinding": candidate ? "placement-candidate" : "not-reported",
              }),
              ...(explicitlyUnresolved && { "bun:explicitlyUnresolved": true }),
              ...(strippedCatalog && { "bun:catalogReferenceStripped": true }),
            },
          },
        );
      }
    };
    for (const { project, locked, caller } of projects.values()) {
      if (!locked && !project.known) {
        for (const scope of NPM_DEPENDENCY_SCOPES) builder.addRoot(project, scope);
        continue;
      }
      declarations(project.consumer, project.manifest, caller, true, locked, undefined, true);
      for (const scope of NPM_DEPENDENCY_SCOPES)
        declarations(
          builder.addRoot(project, scope),
          project.manifest,
          caller,
          false,
          locked,
          scope,
          true,
        );
    }
    for (const entry of entries) {
      const alias = workspaceAliases.get(entry);
      if (alias) {
        const tupleWorkspace =
          document.lockfileVersion === 0 && entry.reference.startsWith("workspace:");
        if (!entry.infoComplete || (!tupleWorkspace && !alias.project.known))
          builder.nodes.get(alias.view)!.dependencyCompleteness = "unknown";
        else
          declarations(
            alias.view,
            tupleWorkspace ? entry.metadata : alias.project.manifest,
            entry.key,
            true,
            true,
            undefined,
            true,
          );
        continue;
      }
      declarations(targets.get(entry.key)!, entry.metadata, entry.key, true, true);
    }
    return mergeResultsV2([
      builder.finish(),
      ...(declared.result.subprojects.length > 0 ? [declared.finish()] : []),
    ]);
  },
});

function record(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Bun lockfile record");
  return value as NpmRecord;
}
function identifier(value: string): { name: string; reference: string } {
  if (value === "@root:") return { name: "", reference: "root:" };
  const at = value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0);
  if (at < 1) throw new Error(`Invalid Bun package identifier: ${value}`);
  return { name: value.slice(0, at), reference: value.slice(at + 1) };
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error("Expected Bun dependency name strings");
  return value;
}
function pathSegments(path: string): string[] {
  const pieces = path ? path.split("/") : [];
  const segments: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const value = pieces[i]!;
    if (value.startsWith("@")) {
      if (!pieces[i + 1]) throw new Error(`Invalid Bun scoped package path: ${path}`);
      segments.push(`${value}/${pieces[++i]}`);
    } else segments.push(value);
  }
  return segments;
}
