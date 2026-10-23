import { createHash } from "node:crypto";
import { dirname, join, normalize, relative } from "node:path/posix";
import { PackageURL } from "packageurl-js";
import { valid, validRange, satisfies } from "semver";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  mergeResultsV2,
  normalizeResultV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  scanFiles,
  type AnalyzerResultV2,
  type DependencyCondition,
  type DependencyEdge,
  type DependencyRequest,
  type DependencyRoot,
  type DependencyView,
  type FileExtractionContextV2,
  type JsonObject,
  type PackageV2,
  type ProjectReference,
} from "@scatool/analyzer-core";
import { createNpmPurl } from "../npm-utils.ts";
import {
  NpmGraphV2,
  addManifestObservation,
  json,
  loadNpmManifest,
  table,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";

type Kind = "npm" | "jsr";
type Binding = { alias: string; raw: string; target?: string; request: DependencyRequest };

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
    const records = new Map<string, NpmRecord>();
    const npmByName = new Map<string, string[]>();
    const register = (kind: Kind, key: string, metadata: NpmRecord, missing = false): string => {
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
      records.set(id, metadata);
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
        register(kind, key, record(metadata));
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
    const specifiers = table(tables, "specifiers");
    const specifierIndex = new Map<string, string[]>();
    for (const key of Object.keys(specifiers)) {
      const request = registryRequest(key);
      if (!request) continue;
      const name = `${request.kind}:${request.name}`;
      specifierIndex.set(name, [...(specifierIndex.get(name) ?? []), key]);
    }
    const requirement = (value: string): { request: DependencyRequest; target?: string } => {
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
      return { request, target: register(parsed.kind, full, {}, true) };
    };
    const npmBinding = (value: string, alias?: string, allowMissing = true): Binding => {
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
            ? register("npm", actual, {}, true)
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
    const bindings = (metadata: NpmRecord, scope: string): Binding[] => {
      const value = metadata[scope];
      if (value === undefined) return [];
      if (Array.isArray(value))
        return strings(value).map((value) =>
          npmBinding(value, undefined, scope !== "optionalPeers"),
        );
      return Object.entries(record(value)).map(([alias, value]) => {
        if (typeof value !== "string") throw new Error(`Invalid Deno npm dependency '${alias}'`);
        return npmBinding(value, alias, scope !== "optionalPeers");
      });
    };
    // Iterate the source table, not placeholders registered while resolving missing references.
    for (const [key, value] of Object.entries(table(tables, "npm"))) {
      const metadata = record(value);
      const from = `npm:${JSON.stringify(key)}`;
      const dependencies = bindings(metadata, "dependencies");
      const optionalDependencies = version >= 5 ? bindings(metadata, "optionalDependencies") : [];
      const optionalPeers = version >= 5 ? bindings(metadata, "optionalPeers") : [];
      const usedPeers = new Set<Binding>();
      for (const binding of dependencies) {
        const peer = optionalPeers.find(
          (peer) =>
            peer.alias === binding.alias &&
            ((peer.target !== undefined && peer.target === binding.target) ||
              (peer.request.specifier !== undefined &&
                binding.target !== undefined &&
                (() => {
                  const target = native.nodes.get(binding.target!)!;
                  const version = PackageURL.fromString(target.purl).version;
                  return (
                    version !== undefined &&
                    version !== null &&
                    validRange(peer.request.specifier!) !== null &&
                    satisfies(version, peer.request.specifier!)
                  );
                })())),
        );
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
        const resolved = requirement(dependency);
        native.edge(
          `jsr:${JSON.stringify(key)}`,
          resolved.request,
          resolved.target,
          "dependencies",
          { attributes: { "deno:requirement": dependency } },
        );
      }
    const workspace = table(document, "workspace");
    const members = new Map<string, NpmRecord>([
      [".", workspace],
      ...Object.entries(table(workspace, "members")).map(
        ([location, value]) => [normalize(location), record(value)] as const,
      ),
    ]);
    const loadedConfigs = new Map<string, { manifest: NpmRecord; file?: string }>();
    const loadConfig = async (location: string) => {
      if (loadedConfigs.has(location)) return loadedConfigs.get(location)!;
      let loaded: { manifest: NpmRecord; file?: string } = { manifest: {} };
      for (const name of ["deno.json", "deno.jsonc"]) {
        const path = join(dirname(file), location, name);
        try {
          const errors: ParseError[] = [];
          const manifest = record(
            parseJsonc(await readNormalizedTextFile(path), errors, { allowTrailingComma: true }),
          );
          if (errors.length > 0) throw new Error("Invalid Deno configuration JSONC");
          loaded = { manifest, file: join(dirname(context.relativeFile), location, name) };
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
      for (const pattern of strings(rootConfig.manifest.workspace))
        for (const path of await scanFiles(
          dirname(file),
          `${pattern}/{deno.json,deno.jsonc,package.json}`,
          options.ignore,
        )) {
          const location = normalize(relative(dirname(file), dirname(path)));
          if (!members.has(location)) members.set(location, {});
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
      if (location === ".." || location.startsWith("../") || location.startsWith("/"))
        throw new Error(`Deno member is outside its lockfile directory: ${location}`);
      const config = await loadConfig(location);
      const jsonManifest = await loadNpmManifest(
        join(dirname(file), location, "package.json"),
        {},
        packageJson,
      );
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
          const resolved = requirement(dependency);
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
          const resolved = requirement(dependency);
          native.edge(root, resolved.request, resolved.target, "packageJson:dependencies");
        }
      }
      if (config.file) {
        const project = declared.project(location, "deno", config.manifest, config.file);
        try {
          const scopes = [
            { scope: "imports", imports: table(config.manifest, "imports") },
            ...Object.entries(table(config.manifest, "scopes")).map(([scope, imports]) => ({
              scope: `imports:${scope}`,
              imports: record(imports),
              condition: {
                language: "deno:import-scope/v1",
                expression: { referrerPrefix: scope },
              },
            })),
          ];
          for (const scope of scopes) {
            const root = declared.root(project, scope.scope);
            if (config.manifest.importMap !== undefined)
              declared.nodes.get(root)!.dependencyCompleteness = "unknown";
            for (const [alias, specifier] of Object.entries(scope.imports)) {
              if (typeof specifier !== "string")
                throw new Error(`Invalid Deno import mapping for '${alias}'`);
              declared.edge(root, { name: alias, specifier }, undefined, "imports", {
                declaration: true,
                ...("condition" in scope && { condition: scope.condition }),
              });
            }
          }
        } catch (error) {
          declared.rootCompleteness = "partial";
          if (
            !declared.roots.some((root) => root.project.definitionFile === project.definitionFile)
          )
            declared.root(project, "imports");
          for (const root of declared.roots.filter(
            (root) => root.project.definitionFile === project.definitionFile,
          ))
            declared.nodes.get(root.node)!.dependencyCompleteness = "unknown";
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

class DenoObservation {
  readonly result: AnalyzerResultV2;
  readonly packages = new Map<string, PackageV2>();
  readonly nodes = new Map<string, DependencyView>();
  readonly edges: DependencyEdge[] = [];
  readonly roots: DependencyRoot[] = [];
  readonly attributes: JsonObject = {};
  readonly files: Set<string>;
  rootCompleteness: "complete" | "partial" | "unknown" = "complete";
  constructor(
    readonly context: FileExtractionContextV2,
    readonly interpretation: "locked" | "declared",
    readonly key: string,
  ) {
    this.result = createEmptyResultV2(context.codebaseId);
    this.files = new Set(interpretation === "locked" ? [context.relativeFile] : []);
  }
  issue(code: string, message: string): void {
    this.result.issues.push({
      code,
      message,
      severity: "WARNING",
      file: this.context.relativeFile,
    });
  }
  package(
    id: string,
    purl: string,
    locator: string,
    metadata: NpmRecord,
    complete: boolean,
    synthesizedPurl: boolean,
  ): void {
    const evidence = [this.context.relativeFile];
    const artifact =
      typeof metadata.integrity === "string" ||
      typeof metadata.tarball === "string" ||
      typeof metadata.url === "string"
        ? {
            evidence,
            ...(typeof (metadata.tarball ?? metadata.url) === "string" && {
              location: (metadata.tarball ?? metadata.url) as string,
            }),
            ...(typeof metadata.integrity === "string" && {
              attributes: { "deno:integrity": metadata.integrity },
            }),
          }
        : undefined;
    const pkg = this.packages.get(purl) ?? {
      purl,
      evidence,
      ...(synthesizedPurl && { synthesizedPurl: true }),
    };
    if (artifact) pkg.artifacts = [...(pkg.artifacts ?? []), artifact];
    this.packages.set(purl, pkg);
    this.nodes.set(id, {
      id,
      purl,
      locator,
      dependencyCompleteness: complete ? "complete" : "unknown",
      evidence,
      ...(artifact && { artifacts: [artifact] }),
      attributes: { "deno:record": json(metadata) },
    });
  }
  project(
    location: string,
    kind: Kind | "deno",
    config: NpmRecord,
    definitionFile: string,
  ): ProjectReference {
    const version =
      typeof config.version === "string" && config.version ? config.version : undefined;
    const name = typeof config.name === "string" && config.name ? config.name : undefined;
    const purl = name
      ? kind === "npm"
        ? createNpmPurl(name, version ?? "")
        : name.startsWith("@") && name.includes("/")
          ? registryPurl("jsr", name, version)
          : new PackageURL("generic", "deno", name, version ?? null, null, null).toString()
      : genericPurl("deno-project", [this.context.codebaseId, location, kind, definitionFile]);
    const project = { purl, definitionFile };
    this.result.subprojects.push({
      ...project,
      evidence: [definitionFile],
      ...(!name && { synthesizedPurl: true }),
      attributes: {
        "deno:projectKind": kind,
        "deno:configuration": json(
          Object.fromEntries(
            ["name", "version", "imports", "scopes", "importMap", "workspace", "links", "patches"]
              .filter((key) => config[key] !== undefined)
              .map((key) => [key, config[key]]),
          ),
        ),
      },
    });
    if (!definitionFile.startsWith(`${this.context.relativeFile}#`)) this.files.add(definitionFile);
    return project;
  }
  root(project: ProjectReference, scope: string): string {
    const id = `scope:${JSON.stringify([project.definitionFile, scope])}`;
    this.nodes.set(id, {
      id,
      purl: project.purl,
      project,
      dependencyCompleteness: "complete",
      evidence: [project.definitionFile],
    });
    this.roots.push({ id, project, scope, node: id });
    return id;
  }
  edge(
    from: string,
    requested: DependencyRequest,
    target: string | undefined,
    kind: string,
    options: {
      optional?: boolean;
      attributes?: JsonObject;
      declaration?: boolean;
      condition?: DependencyCondition;
      selection?: "selected" | "unknown";
    } = {},
  ): void {
    const metadata =
      target === undefined
        ? {}
        : ((this.nodes.get(target)?.attributes?.["deno:record"] as NpmRecord | undefined) ?? {});
    const platform = Object.fromEntries(
      ["os", "cpu", "libc"]
        .filter((key) => metadata[key] !== undefined)
        .map((key) => [key, json(metadata[key])]),
    );
    const condition =
      options.condition ??
      (Object.keys(platform).length > 0
        ? { language: "npm:platform/v1", expression: platform }
        : undefined);
    const common = {
      from,
      relation: "depends-on" as const,
      kind,
      requested,
      evidence: [
        this.interpretation === "declared"
          ? (this.nodes.get(from)?.project?.definitionFile ?? this.context.relativeFile)
          : this.context.relativeFile,
      ],
      ...(options.optional !== undefined && { optional: options.optional }),
      ...(options.attributes && { attributes: options.attributes }),
      ...(condition
        ? {
            selection:
              options.selection === "unknown" ? ("unknown" as const) : ("conditional" as const),
            condition,
          }
        : { selection: options.selection ?? "selected" }),
    };
    if (target !== undefined) this.edges.push({ ...common, status: "resolved", to: target });
    else {
      this.edges.push({ ...common, status: options.declaration ? "declared" : "unresolved" });
      if (!options.declaration)
        this.issue(
          "deno.unresolved_dependency",
          `Could not establish a native binding for '${requested.name ?? requested.specifier ?? "unknown"}' (${kind})`,
        );
    }
  }
  finish(): AnalyzerResultV2 {
    this.result.packages = [...this.packages.values()];
    this.result.graphs.push(
      createDependencyGraph({
        source: { extractor: "denolock", files: [...this.files], key: this.key },
        interpretation: this.interpretation,
        rootCompleteness: this.rootCompleteness,
        roots: this.roots,
        nodes: [...this.nodes.values()],
        edges: this.edges,
        attributes: this.attributes,
      }),
    );
    return normalizeResultV2(this.result);
  }
}
function packageDescriptor(value: string): { name: string; reference?: string } {
  const at = value.indexOf("@", 1);
  return at === -1 ? { name: value } : { name: value.slice(0, at), reference: value.slice(at + 1) };
}
function registryRequest(
  value: string,
): (ReturnType<typeof packageDescriptor> & { kind: Kind }) | undefined {
  const kind = value.startsWith("npm:") ? "npm" : value.startsWith("jsr:") ? "jsr" : undefined;
  return kind ? { kind, ...packageDescriptor(value.slice(kind.length + 1)) } : undefined;
}
function registryPurl(kind: Kind, name: string, version?: string): string {
  const slash = name.indexOf("/");
  return new PackageURL(
    kind,
    name.startsWith("@") && slash > 0 ? name.slice(0, slash) : null,
    name.startsWith("@") && slash > 0 ? name.slice(slash + 1) : name,
    version ?? null,
    null,
    null,
  ).toString();
}
function genericPurl(namespace: string, identity: string[]): string {
  return new PackageURL(
    "generic",
    namespace,
    createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    null,
    null,
    null,
  ).toString();
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
