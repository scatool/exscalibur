import { realpath } from "node:fs/promises";
import { isAbsolute, relative as filesystemRelative, resolve, sep } from "node:path";
import { dirname, join, normalize, relative } from "node:path/posix";
import { PackageURL } from "packageurl-js";
import { valid, validRange, satisfies } from "semver";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  scanFiles,
  type DependencyRequest,
} from "@scatool/analyzer-core";
import {
  NpmGraphV2,
  addManifestObservation,
  assertPortableManifest,
  json,
  loadNpmManifest,
  table,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { DenoObservation, genericPurl, registryPurl, type RegistryKind } from "./observation.ts";

type NpmBinding = { alias: string; raw: string; target?: string; request: DependencyRequest };

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "denolock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/deno.lock", options.ignore);
  },
  extractFile: async (file, options, context) => {
    const document = record(JSON.parse(await readNormalizedTextFile(file)));
    if (
      !["3", "4", "5"].includes(
        typeof document.version === "number"
          ? String(document.version)
          : (document.version as string),
      )
    )
      throw new Error(`Unsupported Deno lockfile version: ${JSON.stringify(document.version)}`);

    const version = Number(document.version);
    const tables = version === 3 ? table(document, "packages") : document;
    const native = new DenoObservation(context, "locked", "native-lock");
    const declared = new DenoObservation(context, "declared", "current-config-declarations");
    const packageJson = new NpmGraphV2(context, "packagejson", "declared");
    packageJson.sourceFiles.clear();

    // Register all native packages before resolving references to them.
    const npmByName = new Map<string, string[]>();
    const registerPackage = (
      kind: RegistryKind,
      key: string,
      metadata: NpmRecord,
      missing = false,
    ): string => {
      const id = `${kind}:${JSON.stringify(key)}`;
      if (native.nodes.has(id)) return id;

      const parsed = packageDescriptor(key);
      const baseVersion = parsed.reference?.split("_")[0];
      const identified = baseVersion !== undefined && valid(baseVersion) !== null;
      const purl = identified
        ? registryPurl(kind, parsed.name, baseVersion)
        : genericPurl("deno-package", [kind, key]);
      if (!identified)
        native.issue(
          "deno.invalid_package_id",
          `Native package ID '${key}' has no exact version; retaining it with a generic PURL`,
        );

      native.package(id, purl, key, metadata, kind === "npm" && !missing, !identified);
      if (missing) {
        native.nodes.get(id)!.attributes!["deno:packageMissing"] = true;
        native.issue(
          "deno.missing_package",
          `Native '${kind}:${key}' binding has no package record; adjacency remains unknown`,
        );
      } else if (kind === "npm")
        npmByName.set(parsed.name, [...(npmByName.get(parsed.name) ?? []), id]);

      return id;
    };

    for (const kind of ["npm", "jsr"] as const)
      for (const [key, metadata] of Object.entries(table(tables, kind)))
        registerPackage(kind, key, record(metadata));

    for (const [url, checksum] of Object.entries(table(document, "remote"))) {
      if (typeof checksum !== "string")
        throw new Error(`Expected a Deno remote checksum for '${url}'`);
      const id = `remote:${JSON.stringify(url)}`;
      native.package(
        id,
        genericPurl("deno-http", [url]),
        url,
        { url, integrity: checksum },
        false,
        true,
      );
    }

    // A registry request resolves through the lockfile specifier table, not a guessed version.
    const specifiers = table(tables, "specifiers");
    const specifierIndex = new Map<string, string[]>();
    for (const key of Object.keys(specifiers)) {
      const request = registryRequest(key);
      if (!request) continue;
      const name = `${request.kind}:${request.name}`;
      specifierIndex.set(name, [...(specifierIndex.get(name) ?? []), key]);
    }

    const resolveRegistryRequirement = (
      value: string,
    ): { request: DependencyRequest; target?: string } => {
      const parsed = registryRequest(value);
      const request: DependencyRequest = { ...(parsed && { name: parsed.name }), specifier: value };
      if (!parsed) return { request };
      const keys = Object.hasOwn(specifiers, value)
        ? [value]
        : parsed.reference === undefined
          ? (specifierIndex.get(`${parsed.kind}:${parsed.name}`) ?? [])
          : [];
      if (keys.length !== 1) return { request };
      const resolution = specifiers[keys[0]!];
      if (typeof resolution !== "string")
        throw new Error(`Invalid Deno specifier resolution: ${keys[0]}`);
      const full = resolution.startsWith(`${parsed.kind}:`)
        ? resolution.slice(parsed.kind.length + 1)
        : version === 3
          ? resolution
          : `${parsed.name}@${resolution}`;
      const descriptor = packageDescriptor(full);
      if (descriptor.reference === undefined || valid(descriptor.reference.split("_")[0]!) === null)
        return { request };
      return { request, target: registerPackage(parsed.kind, full, {}, true) };
    };

    const readNpmBinding = (value: string, alias?: string, allowMissing = true): NpmBinding => {
      const aliasAt = value.indexOf("@npm:");
      const actual = aliasAt > 0 ? value.slice(aliasAt + 5) : value.replace(/^npm:/, "");
      const parsed = packageDescriptor(actual);
      const name = alias ?? (aliasAt > 0 ? value.slice(0, aliasAt) : parsed.name);
      if (parsed.reference === undefined) {
        const candidates = npmByName.get(parsed.name) ?? [];
        if (candidates.length > 1)
          native.issue(
            "deno.ambiguous_dependency",
            `Bare npm dependency '${parsed.name}' has multiple native peer/version contexts; none is selected arbitrarily`,
          );
        return {
          alias: name,
          raw: value,
          request: { name },
          ...(candidates.length === 1 && { target: candidates[0] }),
        };
      }
      const exact = valid(parsed.reference.split("_")[0]!) !== null;
      const existing = `npm:${JSON.stringify(actual)}`;
      const target =
        exact && native.nodes.has(existing)
          ? existing
          : exact && allowMissing
            ? registerPackage("npm", actual, {}, true)
            : undefined;
      return {
        alias: name,
        raw: value,
        request: {
          name,
          ...((!exact || (!allowMissing && validRange(parsed.reference) !== null)) && {
            specifier: parsed.reference,
          }),
        },
        ...(target !== undefined && { target }),
      };
    };

    const readNpmBindings = (metadata: NpmRecord, scope: string): NpmBinding[] => {
      const value = metadata[scope];
      if (value === undefined) return [];
      if (Array.isArray(value))
        return strings(value).map((value) =>
          readNpmBinding(value, undefined, scope !== "optionalPeers"),
        );
      return Object.entries(record(value)).map(([alias, value]) => {
        if (typeof value !== "string") throw new Error(`Invalid Deno npm dependency '${alias}'`);
        return readNpmBinding(value, alias, scope !== "optionalPeers");
      });
    };

    const matchesOptionalPeer = (binding: NpmBinding, peer: NpmBinding): boolean => {
      if (peer.alias !== binding.alias) return false;
      if (peer.target !== undefined && peer.target === binding.target) return true;
      if (peer.request.specifier === undefined || binding.target === undefined) return false;

      // Optional peer records may describe a range instead of repeating the selected package ID.
      const target = native.nodes.get(binding.target)!;
      const version = PackageURL.fromString(target.purl).version;
      return (
        version !== undefined &&
        version !== null &&
        validRange(peer.request.specifier) !== null &&
        satisfies(version, peer.request.specifier)
      );
    };

    // Iterate the source table, not placeholders registered while resolving missing references.
    for (const [key, value] of Object.entries(table(tables, "npm"))) {
      const metadata = record(value);
      const from = `npm:${JSON.stringify(key)}`;
      const dependencies = readNpmBindings(metadata, "dependencies");
      const optionalDependencies =
        version >= 5 ? readNpmBindings(metadata, "optionalDependencies") : [];
      const optionalPeers = version >= 5 ? readNpmBindings(metadata, "optionalPeers") : [];
      const usedPeers = new Set<NpmBinding>();
      for (const binding of dependencies) {
        const peer = optionalPeers.find((peer) => matchesOptionalPeer(binding, peer));
        if (peer) usedPeers.add(peer);
        if (
          optionalDependencies.some(
            (optional) => optional.alias === binding.alias && optional.target === binding.target,
          )
        )
          continue;
        native.edge(
          from,
          peer?.request.specifier ? peer.request : binding.request,
          binding.target,
          peer ? "peerDependencies" : "dependencies",
          {
            ...(peer && { optional: true }),
            attributes: {
              "deno:dependencyReference": binding.raw,
              ...(peer && { "deno:optionalPeer": peer.raw }),
            },
          },
        );
      }
      for (const binding of optionalDependencies)
        native.edge(from, binding.request, binding.target, "optionalDependencies", {
          optional: true,
          attributes: { "deno:dependencyReference": binding.raw },
        });
      for (const binding of optionalPeers)
        if (!usedPeers.has(binding))
          native.edge(from, binding.request, binding.target, "peerDependencies", {
            optional: true,
            selection: "unknown",
            attributes: { "deno:dependencyReference": binding.raw },
            declaration: binding.target === undefined,
          });
    }
    for (const [key, value] of Object.entries(table(tables, "jsr")))
      for (const dependency of strings(record(value).dependencies)) {
        const resolved = resolveRegistryRequirement(dependency);
        native.edge(
          `jsr:${JSON.stringify(key)}`,
          resolved.request,
          resolved.target,
          "dependencies",
          { attributes: { "deno:requirement": dependency } },
        );
      }

    // Current manifests add declaration observations; they do not replace the native lock graph.
    const workspace = table(document, "workspace");
    const members = new Map<string, NpmRecord>([
      [".", workspace],
      ...Object.entries(table(workspace, "members")).map(
        ([location, value]) => [normalize(location), record(value)] as const,
      ),
    ]);

    const codebaseDirectory = await realpath(context.codebasePath);
    const isWithinDirectory = (root: string, path: string): boolean => {
      const within = filesystemRelative(root, path);
      return !isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`);
    };

    const canReadManifest = async (location: string, name: string): Promise<boolean> => {
      const path = join(dirname(file), location, name);
      let safe =
        location !== ".." &&
        !location.startsWith("../") &&
        !location.startsWith("/") &&
        isWithinDirectory(resolve(context.codebasePath), resolve(path));
      if (safe) {
        try {
          safe = isWithinDirectory(codebaseDirectory, await realpath(path));
        } catch (error) {
          if (
            !(
              error !== null &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            native.issue(
              "deno.manifest_unreadable",
              `Could not verify the local manifest '${join(location, name)}'; only recorded lock metadata is used`,
            );
          return false;
        }
      }
      if (!safe)
        native.issue(
          "deno.manifest_outside_codebase",
          `Local manifest '${join(location, name)}' leaves its lockfile directory or the scanned codebase; only recorded lock metadata is used`,
        );
      return safe;
    };

    const loadedConfigs = new Map<string, { manifest: NpmRecord; file?: string }>();
    const loadConfig = async (location: string) => {
      if (loadedConfigs.has(location)) return loadedConfigs.get(location)!;
      let loaded: { manifest: NpmRecord; file?: string } = { manifest: {} };
      for (const name of ["deno.json", "deno.jsonc"]) {
        if (!(await canReadManifest(location, name))) continue;
        const path = join(dirname(file), location, name);
        try {
          const errors: ParseError[] = [];
          const manifest = record(
            parseJsonc(await readNormalizedTextFile(path), errors, { allowTrailingComma: true }),
          );
          if (errors.length > 0) throw new Error("Invalid Deno configuration JSONC");
          assertPortableManifest(manifest);
          const definition = join(dirname(context.relativeFile), location, name);
          const candidate = new DenoObservation(context, "declared", "current-config-declarations");
          candidate.project(location, "deno", manifest, definition);
          candidate.finish();
          loaded = { manifest, file: definition };
          break;
        } catch (error) {
          if (
            !(
              error !== null &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            native.issue(
              "deno.manifest_unreadable",
              `Could not read '${path}': ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      }
      loadedConfigs.set(location, loaded);
      return loaded;
    };

    const rootConfig = await loadConfig(".");
    try {
      for (const pattern of strings(rootConfig.manifest.workspace)) {
        const location = normalize(pattern);
        if (location === ".." || location.startsWith("../") || location.startsWith("/"))
          throw new Error(`Deno workspace pattern is outside its lockfile directory: ${pattern}`);
        for (const path of await scanFiles(
          dirname(file),
          `${pattern}/{deno.json,deno.jsonc,package.json}`,
          options.ignore,
        )) {
          const location = normalize(relative(dirname(file), dirname(path)));
          if (!members.has(location)) members.set(location, {});
        }
      }
    } catch (error) {
      declared.rootCompleteness = "partial";
      declared.result.issues.push({
        code: "deno.workspace_declarations_failed",
        severity: "WARNING",
        file: rootConfig.file ?? context.relativeFile,
        message: `Could not discover current workspace declarations: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const nativeLocations = new Set([
      ".",
      ...Object.keys(table(workspace, "members")).map((key) => normalize(key)),
    ]);
    for (const [location, member] of members) {
      const config = await loadConfig(location);
      const jsonManifest = (await canReadManifest(location, "package.json"))
        ? await loadNpmManifest(join(dirname(file), location, "package.json"), {}, packageJson)
        : { manifest: {}, available: false };
      if (jsonManifest.available) {
        const definition = join(dirname(context.relativeFile), location, "package.json");
        try {
          addManifestObservation(packageJson, location, definition, jsonManifest.manifest);
        } catch (error) {
          const project = packageJson.addProject(
            location,
            definition,
            jsonManifest.manifest,
            false,
          );
          packageJson.addRoot(project, "dependencies");
          packageJson.sourceFiles.add(definition);
          packageJson.rootCompleteness = "unknown";
          packageJson.result.issues.push({
            code: "deno.manifest_declarations_failed",
            severity: "WARNING",
            file: definition,
            message: `Could not read current package declarations: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      const nativeMember = document.workspace !== undefined && nativeLocations.has(location);
      if (
        nativeMember &&
        (config.file ||
          member.dependencies !== undefined ||
          (!jsonManifest.available && member.packageJson === undefined))
      ) {
        const definition =
          config.file ?? `${context.relativeFile}#workspace/${encodeURIComponent(location)}/deno`;
        const project = native.project(location, "deno", config.manifest, definition);
        const root = native.root(project, "deno:dependencies");
        for (const dependency of strings(member.dependencies)) {
          const resolved = resolveRegistryRequirement(dependency);
          native.edge(root, resolved.request, resolved.target, "deno:dependencies");
        }
      }

      if (nativeMember && (jsonManifest.available || member.packageJson !== undefined)) {
        const definition = jsonManifest.available
          ? join(dirname(context.relativeFile), location, "package.json")
          : `${context.relativeFile}#workspace/${encodeURIComponent(location)}/packageJson`;
        const project = native.project(location, "npm", jsonManifest.manifest, definition);
        const root = native.root(project, "packageJson:dependencies");
        for (const dependency of strings(table(member, "packageJson").dependencies)) {
          const resolved = resolveRegistryRequirement(dependency);
          native.edge(root, resolved.request, resolved.target, "packageJson:dependencies");
        }
      }

      if (config.file) {
        try {
          const candidate = new DenoObservation(context, "declared", "current-config-declarations");
          addConfigDeclarations(candidate, location, config.manifest, config.file);
          candidate.finish();
          addConfigDeclarations(declared, location, config.manifest, config.file);
        } catch (error) {
          const project = declared.project(location, "deno", config.manifest, config.file);
          declared.rootCompleteness = "partial";
          const root = declared.root(project, "imports");
          declared.nodes.get(root)!.dependencyCompleteness = "unknown";
          declared.result.issues.push({
            code: "deno.config_declarations_failed",
            severity: "WARNING",
            file: config.file,
            message: `Could not read current import declarations: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    const { npm: _npm, jsr: _jsr, packages: _packages, ...remaining } = document;
    native.attributes["deno:document"] = json(remaining);
    native.attributes["deno:specifiers"] = json(specifiers);
    native.attributes["deno:jsrDependencyCoverage"] = "observed-lock-retention-graph";
    native.rootCompleteness = document.workspace === undefined ? "unknown" : "complete";
    if (packageJson.result.subprojects.length === 0)
      native.result.issues.push(...packageJson.result.issues);

    return mergeResultsV2([
      native.finish(),
      ...(declared.result.subprojects.length > 0 ? [declared.finish()] : []),
      ...(packageJson.result.subprojects.length > 0 ? [packageJson.finish()] : []),
    ]);
  },
});

function addConfigDeclarations(
  observation: DenoObservation,
  location: string,
  manifest: NpmRecord,
  definition: string,
): void {
  const project = observation.project(location, "deno", manifest, definition);
  const scopes = [
    { scope: "imports", imports: table(manifest, "imports") },
    ...Object.entries(table(manifest, "scopes")).map(([scope, imports]) => ({
      scope: `imports:${scope}`,
      imports: record(imports),
      condition: {
        language: "deno:import-scope/v1",
        expression: { referrerPrefix: scope },
      },
    })),
  ];
  for (const scope of scopes) {
    const root = observation.root(project, scope.scope);
    if (manifest.importMap !== undefined)
      observation.nodes.get(root)!.dependencyCompleteness = "unknown";
    for (const [alias, specifier] of Object.entries(scope.imports)) {
      if (typeof specifier !== "string")
        throw new Error(`Invalid Deno import mapping for '${alias}'`);
      observation.edge(root, { name: alias, specifier }, undefined, "imports", {
        declaration: true,
        ...("condition" in scope && { condition: scope.condition }),
      });
    }
  }
}

function packageDescriptor(value: string): { name: string; reference?: string } {
  const at = value.indexOf("@", 1);
  return at === -1 ? { name: value } : { name: value.slice(0, at), reference: value.slice(at + 1) };
}

function registryRequest(
  value: string,
): (ReturnType<typeof packageDescriptor> & { kind: RegistryKind }) | undefined {
  const kind = value.startsWith("npm:") ? "npm" : value.startsWith("jsr:") ? "jsr" : undefined;
  return kind ? { kind, ...packageDescriptor(value.slice(kind.length + 1)) } : undefined;
}

function record(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Deno lock/config record");
  return value as NpmRecord;
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error("Expected Deno dependency specifier strings");
  return value;
}
