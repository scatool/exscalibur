import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResultV2,
  normalizeResultV2,
  type AnalyzerResultV2,
  type Completeness,
  type DependencyCondition,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyRequest,
  type DependencyView,
  type FileExtractionContextV2,
  type JsonObject,
  type JsonValue,
  type PackageV2,
  type ProjectReference,
} from "@scatool/analyzer-core";
import { createNpmPurl, NPM_DEPENDENCY_SCOPES } from "./npm-utils.ts";

export type NpmRecord = Record<string, unknown>;
export type NpmDeclaration = {
  scope: string;
  name: string;
  specifier: string;
  optional?: boolean;
  excluded: boolean;
};
export type NpmProject = {
  reference: ProjectReference;
  manifest: NpmRecord;
  consumer: string;
  known: boolean;
};

/** Shared construction only. Native adapters retain responsibility for choosing the correct target view. */
export class NpmGraphV2 {
  readonly result: AnalyzerResultV2;
  readonly nodes = new Map<string, DependencyView>();
  readonly edges: DependencyEdge[] = [];
  readonly roots: Array<{ id: string; project: ProjectReference; scope: string; node: string }> =
    [];
  readonly sourceFiles: Set<string>;
  readonly packages = new Map<string, PackageV2>();
  readonly attributes: JsonObject = {};
  rootCompleteness: Completeness = "complete";

  constructor(
    readonly context: FileExtractionContextV2,
    readonly extractor: string,
    readonly interpretation: DependencyGraph["interpretation"] = "locked",
  ) {
    this.result = createEmptyResultV2(context.codebaseId);
    this.sourceFiles = new Set([context.relativeFile]);
  }

  addPackage(id: string, name: string, metadata: NpmRecord, known = true): string {
    const version =
      typeof metadata.version === "string" && !isLocator(metadata.version) ? metadata.version : "";
    const purl = createNpmPurl(typeof metadata.name === "string" ? metadata.name : name, version);
    const evidence = [this.context.relativeFile];
    const artifactLocation = typeof metadata.resolved === "string" ? metadata.resolved : undefined;
    const integrity = typeof metadata.integrity === "string" ? metadata.integrity : undefined;
    const artifact =
      artifactLocation || integrity
        ? {
            ...(artifactLocation !== undefined && { location: artifactLocation }),
            ...(integrity !== undefined && { attributes: { "npm:integrity": integrity } }),
            evidence,
          }
        : undefined;
    const catalog = this.packages.get(purl) ?? { purl, evidence };
    if (artifact) catalog.artifacts = [...(catalog.artifacts ?? []), artifact];
    this.packages.set(purl, catalog);
    const platform = platformFields(metadata);
    this.nodes.set(id, {
      id,
      purl,
      locator: id,
      dependencyCompleteness: known ? "complete" : "unknown",
      evidence,
      ...(artifact !== undefined && { artifacts: [artifact] }),
      attributes: {
        "npm:metadata": json(metadata),
        ...(Object.keys(platform).length > 0 && { "npm:platform": platform }),
      },
    });
    return id;
  }

  addProject(
    locator: string,
    definitionFile: string,
    manifest: NpmRecord,
    known: boolean,
  ): NpmProject {
    const nativeName =
      typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : undefined;
    const version = typeof manifest.version === "string" ? manifest.version : "";
    const purl = nativeName
      ? createNpmPurl(nativeName, version)
      : new PackageURL(
          "generic",
          "excalibur",
          `project-${createHash("sha256")
            .update(JSON.stringify([this.context.codebaseId, definitionFile]))
            .digest("hex")}`,
          version || null,
          null,
          null,
        ).toString();
    const reference = { purl, definitionFile };
    this.result.subprojects.push({
      ...reference,
      evidence: [definitionFile],
      identityObservations: [
        {
          source: {
            extractor: this.extractor,
            files: [definitionFile],
            key: JSON.stringify(locator),
          },
          synthesizedPurl: !nativeName,
        },
      ],
    });
    const consumer = `workspace:${JSON.stringify(locator)}`;
    const platform = platformFields(manifest);
    this.nodes.set(consumer, {
      id: consumer,
      purl,
      project: reference,
      locator,
      dependencyCompleteness: known ? "complete" : "unknown",
      evidence: [definitionFile],
      attributes: {
        ...(Object.keys(platform).length > 0 && { "npm:platform": platform }),
        "npm:projectMetadata": json(
          Object.fromEntries(
            [
              "name",
              "version",
              "private",
              "type",
              "packageManager",
              "engines",
              "os",
              "cpu",
              "libc",
              "peerDependenciesMeta",
              "dependenciesMeta",
              "overrides",
              "resolutions",
              "pnpm",
              "bundleDependencies",
              "bundledDependencies",
            ]
              .filter((key) => Object.hasOwn(manifest, key))
              .map((key) => [key, manifest[key]]),
          ),
        ),
      },
    });
    return { reference, manifest, consumer, known };
  }

  addRoot(project: NpmProject, scope: string): string {
    const id = `scope:${JSON.stringify([project.reference.definitionFile, scope])}`;
    this.nodes.set(id, {
      id,
      purl: project.reference.purl,
      project: project.reference,
      dependencyCompleteness: project.known ? "complete" : "unknown",
      evidence: [project.reference.definitionFile],
    });
    this.roots.push({ id, project: project.reference, scope, node: id });
    return id;
  }

  dependency(
    from: string,
    name: string,
    specifier: string,
    kind: string,
    target: string | undefined,
    options: {
      optional?: boolean;
      selection?: "selected" | "excluded" | "unknown";
      status?: "declared" | "unresolved";
      attributes?: JsonObject;
      requested?: DependencyRequest;
      /** Adapter-owned applicability; include every native predicate when overriding platform defaults. */
      condition?: DependencyCondition;
    } = {},
  ): void {
    const selection = options.selection ?? "selected";
    const requested = options.requested ?? {
      name,
      specifier,
      id: JSON.stringify([from, kind, name]),
    };
    const metadata = {
      from,
      relation: "depends-on" as const,
      kind,
      requested,
      ...(options.optional !== undefined && { optional: options.optional }),
      ...(options.attributes !== undefined && { attributes: options.attributes }),
      evidence: [
        ...new Set([
          this.nodes.get(from)?.project?.definitionFile ?? this.context.relativeFile,
          ...(this.interpretation === "locked" ? [this.context.relativeFile] : []),
        ]),
      ],
    };
    const platform = target ? this.nodes.get(target)?.attributes?.["npm:platform"] : undefined;
    const condition =
      options.condition ??
      (platform !== undefined ? { language: "npm:platform/v1", expression: platform } : undefined);
    const applicability =
      condition !== undefined && selection !== "excluded"
        ? {
            selection: selection === "unknown" ? ("unknown" as const) : ("conditional" as const),
            condition,
          }
        : { selection };
    if (target !== undefined) {
      if (!this.nodes.has(target))
        throw new Error(`Unknown native npm dependency target: ${target}`);
      this.edges.push({ ...metadata, ...applicability, status: "resolved", to: target });
    } else {
      const status = options.status ?? "unresolved";
      this.edges.push({ ...metadata, ...applicability, status });
      if (status === "unresolved" && selection !== "excluded") {
        this.result.issues.push({
          code: "npm.unresolved_dependency",
          severity: "WARNING",
          file: this.nodes.get(from)?.project?.definitionFile ?? this.context.relativeFile,
          message: `Could not resolve '${name}' (${specifier}) from its native lockfile ${kind}`,
        });
      }
    }
  }

  finish(): AnalyzerResultV2 {
    this.result.packages = [...this.packages.values()];
    this.result.graphs.push(
      createDependencyGraph({
        source: { extractor: this.extractor, files: [...this.sourceFiles] },
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

export function addManifestObservation(
  builder: NpmGraphV2,
  location: string,
  definitionFile: string,
  manifest: NpmRecord,
  declarations: NpmDeclaration[] = dependencyScopes(manifest),
): void {
  const project = builder.addProject(location, definitionFile, manifest, true);
  builder.sourceFiles.add(definitionFile);
  builder.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";
  for (const scope of NPM_DEPENDENCY_SCOPES) {
    const root = builder.addRoot(project, scope);
    for (const declaration of declarations.filter((item) => item.scope === scope)) {
      builder.dependency(root, declaration.name, declaration.specifier, scope, undefined, {
        status: "declared",
        selection: declaration.excluded ? "excluded" : "selected",
        optional: declaration.optional,
      });
    }
  }
}

/** A malformed auxiliary manifest must not invalidate an independent native lock observation. */
export function addCurrentManifestObservation(
  builder: NpmGraphV2,
  location: string,
  definitionFile: string,
  manifest: NpmRecord,
  readDeclarations: () => NpmDeclaration[] = () => dependencyScopes(manifest),
): boolean {
  let declarations: NpmDeclaration[];
  try {
    declarations = readDeclarations();
    const candidate = new NpmGraphV2(builder.context, builder.extractor, builder.interpretation);
    addManifestObservation(candidate, location, definitionFile, manifest, declarations);
    candidate.finish();
  } catch (error) {
    const project = builder.addProject(location, definitionFile, manifest, false);
    builder.sourceFiles.add(definitionFile);
    builder.nodes.get(project.consumer)!.attributes!["npm:invalidDeclarations"] = json(
      Object.fromEntries(
        [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta", "dependenciesMeta"]
          .filter((key) => Object.hasOwn(manifest, key))
          .map((key) => [key, manifest[key]]),
      ),
    );
    for (const scope of NPM_DEPENDENCY_SCOPES) builder.addRoot(project, scope);
    builder.rootCompleteness = "partial";
    builder.result.issues.push({
      code: "npm.manifest_declarations_failed",
      severity: "WARNING",
      file: definitionFile,
      message: `Could not read current manifest declarations; native lock evidence is retained: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
  addManifestObservation(builder, location, definitionFile, manifest, declarations);
  return true;
}

export function table(record: NpmRecord, name: string): Record<string, unknown> {
  if (!Object.hasOwn(record, name)) return {};
  const value = record[name];
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected an npm ${name} table`);
  return value as NpmRecord;
}

export function dependencyScopes(record: NpmRecord): NpmDeclaration[] {
  const optional = table(record, "optionalDependencies");
  const peerMeta = table(record, "peerDependenciesMeta");
  return NPM_DEPENDENCY_SCOPES.flatMap((scope) =>
    Object.entries(table(record, scope)).flatMap(([name, value]) => {
      if (name.length === 0) throw new Error(`Expected a nonempty ${scope} dependency name`);
      if (typeof value !== "string")
        throw new Error(`Expected a string ${scope} request for '${name}'`);
      const meta = peerMeta[name];
      return [
        {
          scope,
          name,
          specifier: value,
          optional:
            scope === "optionalDependencies" ||
            (scope === "peerDependencies" &&
              meta !== null &&
              typeof meta === "object" &&
              "optional" in meta &&
              meta.optional === true),
          excluded: scope === "dependencies" && Object.hasOwn(optional, name),
        },
      ];
    }),
  );
}

export async function loadNpmManifest(
  file: string,
  fallback: NpmRecord,
  builder: NpmGraphV2,
): Promise<{ manifest: NpmRecord; available: boolean }> {
  try {
    const value: unknown = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected a package manifest object");
    assertPortableManifest(value);
    // Validate the exact project representation before its identity/metadata can enter a lock graph.
    const candidate = new NpmGraphV2(builder.context, "packagejson", "declared");
    candidate.addProject(".", file, value as NpmRecord, true);
    candidate.finish();
    return { manifest: value as NpmRecord, available: true };
  } catch (error) {
    if (
      !(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
    ) {
      builder.result.issues.push({
        code: "npm.manifest_unreadable",
        severity: "WARNING",
        file,
        message: `Could not read package manifest; using lockfile metadata: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return { manifest: fallback, available: false };
  }
}

/** JSONC parsing and JSON.stringify can hide nonfinite numbers; inspect auxiliary input first. */
export function assertPortableManifest(value: unknown): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error("Manifest contains a nonportable number; current manifest data is omitted");
  if (value !== null && typeof value === "object")
    for (const item of Object.values(value)) assertPortableManifest(item);
}

export function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function platformFields(metadata: NpmRecord): JsonObject {
  return Object.fromEntries(
    ["os", "cpu", "libc"].flatMap((key) => {
      const value = metadata[key];
      return typeof value === "string" ||
        (Array.isArray(value) && value.every((item) => typeof item === "string"))
        ? [[key, value]]
        : [];
    }),
  );
}

function isLocator(value: string): boolean {
  return /^(?:file:|link:|https?:|git\+|git:|github:|gitlab:|bitbucket:)/.test(value);
}
