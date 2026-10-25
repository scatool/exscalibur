import { createHash } from "node:crypto";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResult,
  normalizeResult,
  type AnalyzerResult,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyRoot,
  type DependencyView,
  type JsonObject,
  type JsonValue,
  type Package,
  type ProjectReference,
} from "@scatool/analyzer-core";

export type CargoRecord = Record<string, unknown>;
export type CargoObservationOptions = {
  codebase: string;
  evidenceFile: string;
  /** Explicitly map the native workspace root into the caller's codebase; absent keeps imported subjects. */
  definitionFilePrefix?: string;
  context?: JsonObject;
  toolVersion?: string;
};

/** Source qualifiers are an Excalibur convention; local identity never implies crates.io. */
export function cargoIdentity(
  name: string,
  version: string,
  source: unknown,
  localIdentity: string[],
): { purl: string; synthesizedPurl?: true } {
  if (source === undefined || source === null)
    return {
      purl: new PackageURL(
        "generic",
        "cargo-local",
        `${name}-${digest(localIdentity)}`,
        version,
        null,
        null,
      ).toString(),
      synthesizedPurl: true,
    };
  if (typeof source !== "string" || !source) throw new Error("Expected a Cargo source ID");
  const cratesIo =
    source === "registry+https://github.com/rust-lang/crates.io-index" ||
    source === "sparse+https://index.crates.io/";
  return {
    purl: new PackageURL(
      "cargo",
      null,
      name,
      version,
      cratesIo ? null : { cargo_source: source },
      null,
    ).toString(),
  };
}
export function cargoUnknownIdentity(kind: string, identity: string[]): string {
  return new PackageURL(
    "generic",
    "cargo-unknown",
    `${kind}-${digest(identity)}`,
    null,
    null,
    null,
  ).toString();
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class CargoObservation {
  readonly result: AnalyzerResult;
  readonly packages = new Map<string, Package>();
  readonly nodes = new Map<string, DependencyView>();
  readonly edges: DependencyEdge[] = [];
  readonly roots: DependencyRoot[] = [];
  readonly attributes: JsonObject = {};
  rootCompleteness: DependencyGraph["rootCompleteness"] = "unknown";
  constructor(
    readonly options: CargoObservationOptions,
    readonly key: string,
    readonly interpretation: DependencyGraph["interpretation"],
    readonly extractor: string,
  ) {
    this.result = createEmptyResult(options.codebase);
  }
  issue(code: string, message: string, severity: "WARNING" | "HINT" = "WARNING"): void {
    this.result.issues.push({ code, message, severity, file: this.options.evidenceFile });
  }
  package(node: DependencyView, synthesizedPurl?: true): void {
    if (this.nodes.has(node.id)) throw new Error(`Duplicate Cargo view ID: ${node.id}`);
    this.nodes.set(node.id, node);
    const existing = this.packages.get(node.purl);
    const pkg: Package = existing ?? {
      purl: node.purl,
      evidence: [this.options.evidenceFile],
    };
    pkg.identityObservations = [
      ...(pkg.identityObservations ?? []),
      {
        source: {
          extractor: this.extractor,
          files: [this.options.evidenceFile],
          key: JSON.stringify([this.key, node.id]),
        },
        synthesizedPurl: synthesizedPurl === true,
      },
    ];
    if (node.artifacts) pkg.artifacts = [...(pkg.artifacts ?? []), ...node.artifacts];
    this.packages.set(node.purl, pkg);
  }
  project(
    id: string,
    definitionFile: string,
    origin = "metadata.workspace_members",
  ): ProjectReference {
    const node = this.nodes.get(id)!;
    const project = { purl: node.purl, definitionFile };
    node.project = project;
    this.result.subprojects.push({
      ...project,
      evidence: [this.options.evidenceFile],
      identityObservations: this.packages
        .get(node.purl)!
        .identityObservations!.filter(
          (item) => item.source.key === JSON.stringify([this.key, node.id]),
        ),
      attributes: { "cargo:packageId": node.locator ?? id, "cargo:projectSource": origin },
    });
    return project;
  }
  root(project: ProjectReference, scope: string, node: string): void {
    this.roots.push({
      id: JSON.stringify([project, scope]),
      project,
      scope,
      node,
      evidence: [this.options.evidenceFile],
    });
  }
  finish(): AnalyzerResult {
    this.result.packages = [...this.packages.values()];
    this.result.graphs.push(
      createDependencyGraph({
        source: {
          extractor: this.extractor,
          files: [this.options.evidenceFile],
          key: this.key,
          ...(this.options.toolVersion && {
            tool: { name: "cargo", version: this.options.toolVersion },
          }),
        },
        interpretation: this.interpretation,
        rootCompleteness: this.rootCompleteness,
        nodes: [...this.nodes.values()],
        edges: this.edges,
        roots: this.roots,
        attributes: this.attributes,
        ...(this.options.context && { context: this.options.context }),
      }),
    );
    return normalizeResult(this.result);
  }
}
export function record(value: unknown): CargoRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Cargo record");
  return value as CargoRecord;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected a Cargo array");
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Expected a nonempty Cargo string");
  return value;
}
export function strings(value: unknown): string[] {
  return array(value).map(text);
}
export function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
export function cargoKind(value: unknown): string {
  return value === undefined
    ? "cargo:unreported-kind"
    : value === null
      ? "dependencies"
      : value === "dev"
        ? "dev-dependencies"
        : value === "build"
          ? "build-dependencies"
          : `cargo:kind:${text(value)}`;
}
