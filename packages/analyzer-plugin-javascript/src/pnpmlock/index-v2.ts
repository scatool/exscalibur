import { dirname, join, normalize } from "node:path/posix";
import { parse as parseYaml } from "yaml";
import {
  filesExtractorV2,
  mergeResultsV2,
  readTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import {
  NpmGraphV2,
  addManifestObservation,
  json,
  loadNpmManifest,
  table,
  type NpmProject,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "pnpmlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/pnpm-lock.yaml", options.ignore);
  },
  extractFile: async (file, _options, context) => {
    const raw = record(parseYaml(await readTextFile(file)));
    const version =
      typeof raw.lockfileVersion === "number"
        ? raw.lockfileVersion
        : typeof raw.lockfileVersion === "string"
          ? Number.parseFloat(raw.lockfileVersion)
          : Number.NaN;
    if (
      !Number.isFinite(version) ||
      version < 5 ||
      (version >= 7 && version < 9) ||
      version >= 10
    ) {
      throw new Error(`Unsupported pnpm lockfile version: ${JSON.stringify(raw.lockfileVersion)}`);
    }
    const builder = new NpmGraphV2(context, "pnpmlock");
    const manifests = new NpmGraphV2(context, "packagejson", "declared");
    manifests.sourceFiles.clear();
    builder.attributes["pnpm:lockfileVersion"] = json(raw.lockfileVersion);
    for (const key of [
      "settings",
      "overrides",
      "patchedDependencies",
      "packageExtensionsChecksum",
    ]) {
      if (raw[key] !== undefined) builder.attributes[`pnpm:${key}`] = json(raw[key]);
    }
    const packages = table(raw, "packages");
    const snapshots = version >= 9 ? table(raw, "snapshots") : packages;
    const metadataKeys = Object.keys(packages);
    const nodes = new Map<string, string>();
    const metadataFor = (key: string): string | undefined => {
      if (Object.hasOwn(packages, key)) return key;
      if (!key.includes("(")) return undefined;
      const prefix = key.slice(0, key.indexOf("(") === -1 ? key.length : key.indexOf("("));
      if (Object.hasOwn(packages, prefix)) return prefix;
      return metadataKeys
        .filter((base) => key.startsWith(`${base}(`))
        .sort((a, b) => b.length - a.length)[0];
    };
    const register = (key: string, known: boolean, metadataKey?: string): string => {
      const existing = nodes.get(key);
      if (existing) return existing;
      const metadata = metadataKey === undefined ? {} : record(packages[metadataKey]);
      const identity =
        typeof metadata.name === "string" && typeof metadata.version === "string"
          ? { name: metadata.name, version: metadata.version }
          : parseKey(metadataKey ?? key);
      const resolution = table(metadata, "resolution");
      const data = {
        ...metadata,
        version: typeof metadata.version === "string" ? metadata.version : identity.version,
        ...(typeof resolution.tarball === "string" && { resolved: resolution.tarball }),
        ...(typeof resolution.integrity === "string" && { integrity: resolution.integrity }),
      };
      const id = builder.addPackage(`snapshot:${JSON.stringify(key)}`, identity.name, data, known);
      builder.nodes.get(id)!.locator = key;
      builder.nodes.get(id)!.attributes!["pnpm:snapshotKey"] = key;
      nodes.set(key, id);
      return id;
    };
    // A full snapshot key, including peers/patches, is the contextual identity. Never strip it
    // from graph references or infer a target by matching only its package PURL.
    const coveredMetadata = new Set<string>();
    for (const [key, snapshot] of Object.entries(snapshots)) {
      const metadata = metadataFor(key);
      if (metadata !== undefined) coveredMetadata.add(metadata);
      const id = register(key, true, metadata);
      builder.nodes.get(id)!.attributes!["pnpm:snapshot"] = json(snapshot);
    }
    for (const key of metadataKeys) {
      if (!coveredMetadata.has(key)) register(key, false, key);
    }

    const importers = raw.importers === undefined ? { ".": raw } : table(raw, "importers");
    const projects = new Map<string, { project: NpmProject; importer: NpmRecord }>();
    for (const [location, value] of Object.entries(importers)) {
      const importer = record(value);
      const loaded = await loadNpmManifest(
        join(dirname(file), location, "package.json"),
        {},
        builder,
      );
      const definitionFile = loaded.available
        ? join(dirname(context.relativeFile), location, "package.json")
        : `${context.relativeFile}#importers/${encodeURIComponent(location)}`;
      const specs: NpmRecord = {};
      for (const key of ["name", "version", "private", "os", "cpu", "libc"]) {
        if (loaded.manifest[key] !== undefined) specs[key] = loaded.manifest[key];
      }
      for (const scope of NPM_DEPENDENCY_SCOPES) {
        specs[scope] = Object.fromEntries(
          Object.entries(table(importer, scope)).map(([name, value]) => {
            const ref = dependencyReference(value);
            const original = table(importer, "specifiers")[name];
            return [name, ref.specifier ?? (typeof original === "string" ? original : ref.version)];
          }),
        );
      }
      const project = builder.addProject(location, definitionFile, specs, true);
      projects.set(normalize(location), { project, importer });
      if (loaded.available) {
        builder.sourceFiles.add(definitionFile);
        // Importers encode a selected dependency observation, not necessarily every current
        // manifest declaration (notably peer requirements). Keep the source declaration separately.
        addManifestObservation(manifests, location, definitionFile, loaded.manifest);
      }
    }

    const resolve = (name: string, reference: string, owner?: string): string | undefined => {
      if (reference.startsWith("link:")) {
        if (owner === undefined) return undefined;
        return projects.get(normalize(join(owner, reference.slice(5))))?.project.consumer;
      }
      const direct = reference.startsWith("npm:") ? reference.slice(4) : reference;
      const candidates = [`${name}@${direct}`, direct, `/${name}@${direct}`, `/${name}/${direct}`];
      for (const candidate of candidates) {
        const existing = nodes.get(candidate);
        if (existing) return existing;
      }
      for (const candidate of candidates) {
        const metadata = metadataFor(candidate);
        if (metadata === undefined) continue;
        // A reference with no reported snapshot establishes a package, not an arbitrary one
        // of several peer variants. Preserve a separate unknown-adjacency view.
        const id = register(candidate, false, metadata);
        builder.nodes.get(id)!.attributes!["pnpm:snapshotMissing"] = true;
        return id;
      }
      return undefined;
    };
    for (const [location, { project, importer }] of projects) {
      for (const scope of NPM_DEPENDENCY_SCOPES) {
        const root = builder.addRoot(project, scope);
        for (const [name, value] of Object.entries(table(importer, scope))) {
          const reference = dependencyReference(value);
          const target = resolve(name, reference.version, location);
          const specifier = table(project.manifest, scope)[name] as string;
          const overridden =
            scope === "dependencies" &&
            Object.hasOwn(table(importer, "optionalDependencies"), name);
          const optional = scope === "optionalDependencies";
          const selection = overridden
            ? "excluded"
            : optional && target === undefined
              ? "unknown"
              : "selected";
          const options = {
            optional,
            selection,
            ...(optional && target === undefined && { status: "declared" as const }),
            requested: {
              name,
              ...((reference.specifier !== undefined ||
                typeof table(importer, "specifiers")[name] === "string") && { specifier }),
            },
            attributes: { "pnpm:dependencyReference": reference.version },
          } as const;
          builder.dependency(root, name, specifier, scope, target, options);
          builder.dependency(project.consumer, name, specifier, scope, target, {
            ...options,
            selection: overridden || scope === "devDependencies" ? "excluded" : options.selection,
          });
        }
      }
    }

    for (const [key, value] of Object.entries(snapshots)) {
      const snapshot = record(value);
      const from = nodes.get(key)!;
      const base = metadataFor(key);
      const metadata = base === undefined ? {} : record(packages[base]);
      const peers = table(metadata, "peerDependencies");
      const peerMeta = table(metadata, "peerDependenciesMeta");
      const bound = new Set<string>();
      for (const scope of NPM_DEPENDENCY_SCOPES) {
        // In legacy locks the package metadata and snapshot share a record. Its peer ranges
        // are declarations; actual peer bindings are in dependencies/optionalDependencies.
        if (scope === "peerDependencies") continue;
        for (const [name, value] of Object.entries(table(snapshot, scope))) {
          const reference = dependencyReference(value);
          const target = resolve(name, reference.version);
          const peer = Object.hasOwn(peers, name);
          const optional =
            scope === "optionalDependencies" || (peer && table(peerMeta, name).optional === true);
          const original = peers[name];
          const selection =
            scope === "devDependencies"
              ? "excluded"
              : optional && target === undefined
                ? "unknown"
                : "selected";
          builder.dependency(
            from,
            name,
            reference.version,
            peer ? "peerDependencies" : scope,
            target,
            {
              optional,
              selection,
              ...(optional && target === undefined && { status: "declared" as const }),
              requested: {
                name,
                ...(peer && typeof original === "string" && { specifier: original }),
              },
              attributes: {
                "pnpm:dependencyReference": reference.version,
                "pnpm:bindingScope": scope,
              },
            },
          );
          bound.add(name);
        }
      }
      for (const [name, specifier] of Object.entries(peers)) {
        if (bound.has(name)) continue;
        if (typeof specifier !== "string")
          throw new Error(`Invalid pnpm peer declaration for '${name}'`);
        const optional = table(peerMeta, name).optional === true;
        builder.dependency(from, name, specifier, "peerDependencies", undefined, {
          optional,
          status: "declared",
          selection: optional ? "excluded" : "unknown",
        });
      }
    }
    return manifests.result.subprojects.length > 0
      ? mergeResultsV2([builder.finish(), manifests.finish()])
      : builder.finish();
  },
});

function record(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a pnpm lockfile record");
  return value as NpmRecord;
}

function dependencyReference(value: unknown): { version: string; specifier?: string } {
  if (typeof value === "string") return { version: value };
  const ref = record(value);
  if (typeof ref.version !== "string")
    throw new Error("Expected a resolved pnpm dependency reference");
  return {
    version: ref.version,
    ...(typeof ref.specifier === "string" && { specifier: ref.specifier }),
  };
}

function parseKey(key: string): { name: string; version: string } {
  let input = key.replace(/^\//, "");
  // Old dependency paths can include an alternative registry before the actual coordinates.
  // Keep that registry in the native locator rather than mistaking it for the package name.
  if (!key.startsWith("/") && /^[^/@]+\.[^/@]+\//.test(input))
    input = input.slice(input.indexOf("/") + 1);
  const start = input.startsWith("@") ? input.indexOf("/") + 1 : 0;
  const separator = input.indexOf("@", start);
  const slash = input.indexOf("/", start);
  const boundary = slash > 0 && (separator === -1 || slash < separator) ? slash : separator;
  if (boundary > 0) {
    const version = input.slice(boundary + 1);
    return {
      name: input.slice(0, boundary),
      version: /^\d/.test(version) ? version.split(/[(_]/)[0]! : version,
    };
  }
  throw new Error(`Cannot identify native pnpm package key: ${key}`);
}
