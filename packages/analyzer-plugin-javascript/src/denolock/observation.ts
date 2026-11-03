import { createHash } from "node:crypto";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResult,
  normalizeResult,
  type AnalyzerResult,
  type DependencyCondition,
  type DependencyEdge,
  type DependencyRequest,
  type DependencyRoot,
  type DependencyView,
  type FileExtractionContext,
  type JsonObject,
  type Package,
  type ProjectReference,
} from "@scatool/analyzer-core";
import { createNpmPurl } from "../npm-utils.ts";
import { json, type NpmRecord } from "../npm-graph.ts";

export type RegistryKind = "npm" | "jsr";

/** Construct one observation without correlating native locks with current declarations. */
export class DenoObservation {
  readonly result: AnalyzerResult;
  readonly packages = new Map<string, Package>();
  readonly nodes = new Map<string, DependencyView>();
  readonly edges: DependencyEdge[] = [];
  readonly roots: DependencyRoot[] = [];
  readonly attributes: JsonObject = {};
  readonly files: Set<string>;
  rootCompleteness: "complete" | "partial" | "unknown" = "complete";

  constructor(
    readonly context: FileExtractionContext,
    readonly interpretation: "locked" | "declared",
    readonly key: string,
  ) {
    this.result = createEmptyResult(context.codebaseId);
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

    const catalogPackage = this.packages.get(purl) ?? {
      purl,
      evidence,
    };
    catalogPackage.identityObservations = [
      ...(catalogPackage.identityObservations ?? []),
      {
        source: { extractor: "denolock", files: evidence, key: JSON.stringify([this.key, id]) },
        synthesizedPurl,
      },
    ];
    if (artifact) catalogPackage.artifacts = [...(catalogPackage.artifacts ?? []), artifact];
    this.packages.set(purl, catalogPackage);

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
    kind: RegistryKind | "deno",
    config: NpmRecord,
    definitionFile: string,
  ): ProjectReference {
    const version =
      typeof config.version === "string" && config.version ? config.version : undefined;
    const name = typeof config.name === "string" && config.name ? config.name : undefined;
    let purl: string;
    if (!name) {
      // Anonymous projects are local subjects; their path and observation kind establish identity.
      purl = genericPurl("deno-project", [this.context.codebaseId, location, kind, definitionFile]);
    } else if (kind === "npm") {
      purl = createNpmPurl(name, version ?? "");
    } else if (name.startsWith("@") && name.includes("/")) {
      purl = registryPurl("jsr", name, version);
    } else {
      purl = new PackageURL("generic", "deno", name, version ?? null, null, null).toString();
    }

    const project = { purl, definitionFile };
    this.result.subprojects.push({
      ...project,
      evidence: [definitionFile],
      identityObservations: [
        {
          source: { extractor: "denolock", files: [definitionFile], key: this.key },
          synthesizedPurl: !name,
        },
      ],
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

    const edgeMetadata = {
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

    if (target !== undefined) this.edges.push({ ...edgeMetadata, status: "resolved", to: target });
    else {
      this.edges.push({ ...edgeMetadata, status: options.declaration ? "declared" : "unresolved" });
      if (!options.declaration)
        this.issue(
          "deno.unresolved_dependency",
          `Could not establish a native binding for '${requested.name ?? requested.specifier ?? "unknown"}' (${kind})`,
        );
    }
  }

  finish(): AnalyzerResult {
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

    return normalizeResult(this.result);
  }
}

export function registryPurl(kind: RegistryKind, name: string, version?: string): string {
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

export function genericPurl(namespace: string, identity: string[]): string {
  return new PackageURL(
    "generic",
    namespace,
    createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    null,
    null,
    null,
  ).toString();
}
