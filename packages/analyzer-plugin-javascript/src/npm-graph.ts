import { createHash } from "node:crypto";
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
import { createNpmPurl } from "./npm-utils.ts";

export type NpmRecord = Record<string, unknown>;
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

    // Platform predicates belong to the target view. Keep them unevaluated so
    // callers can query the same observation for environments other than this machine.
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
      if (!this.nodes.has(target)) {
        throw new Error(`Unknown native npm dependency target: ${target}`);
      }

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
