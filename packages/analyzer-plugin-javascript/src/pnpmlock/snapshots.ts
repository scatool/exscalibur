import { NpmGraphV2, json, table, type NpmRecord } from "../npm-v2.ts";

/** Full native keys own peer/patch context; package coordinates never select a snapshot. */
export class PnpmSnapshotIndex {
  readonly snapshots: NpmRecord;
  private readonly packages: NpmRecord;
  private readonly metadataKeys: string[];
  private readonly viewIds = new Map<string, string>();
  private readonly missingMetadata = new Set<string>();

  constructor(
    private readonly builder: NpmGraphV2,
    document: NpmRecord,
    version: number,
  ) {
    this.packages = table(document, "packages");
    this.snapshots = version >= 9 ? table(document, "snapshots") : this.packages;
    this.metadataKeys = Object.keys(this.packages);

    // A full snapshot key, including peers/patches, is the contextual identity. Never strip it
    // from graph references or infer a target by matching only its package PURL.
    const coveredMetadata = new Set<string>();
    for (const [key, snapshot] of Object.entries(this.snapshots)) {
      const metadata = this.metadataKeyFor(key);
      if (metadata !== undefined) coveredMetadata.add(metadata);

      const id = this.register(key, metadata !== undefined, metadata);
      this.builder.nodes.get(id)!.attributes!["pnpm:snapshot"] = json(snapshot);

      if (metadata === undefined) {
        this.missingMetadata.add(id);
        this.builder.nodes.get(id)!.attributes!["pnpm:packageMetadataMissing"] = true;
        this.builder.result.issues.push({
          code: "pnpm.package_metadata_missing",
          severity: "WARNING",
          file: this.builder.context.relativeFile,
          message: `Snapshot '${key}' has no package metadata; peer declarations and platform applicability remain unknown`,
        });
      }
    }

    // Metadata without a snapshot still establishes inventory, with unknown adjacency.
    for (const key of this.metadataKeys) {
      if (!coveredMetadata.has(key)) this.register(key, false, key);
    }
  }

  private metadataKeyFor(key: string): string | undefined {
    if (Object.hasOwn(this.packages, key)) return key;
    if (!key.includes("(")) return undefined;

    const prefix = key.slice(0, key.indexOf("(") === -1 ? key.length : key.indexOf("("));
    if (Object.hasOwn(this.packages, prefix)) return prefix;

    return this.metadataKeys
      .filter((base) => key.startsWith(`${base}(`))
      .sort((a, b) => b.length - a.length)[0];
  }

  private register(key: string, known: boolean, metadataKey?: string): string {
    const existing = this.viewIds.get(key);
    if (existing) return existing;

    const metadata = metadataKey === undefined ? {} : readPnpmRecord(this.packages[metadataKey]);
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

    const id = this.builder.addPackage(
      `snapshot:${JSON.stringify(key)}`,
      identity.name,
      data,
      known,
    );
    this.builder.nodes.get(id)!.locator = key;
    this.builder.nodes.get(id)!.attributes!["pnpm:snapshotKey"] = key;
    this.viewIds.set(key, id);

    return id;
  }

  resolvePackage(name: string, reference: string): string | undefined {
    const direct = reference.startsWith("npm:") ? reference.slice(4) : reference;
    const candidates = [`${name}@${direct}`, direct, `/${name}@${direct}`, `/${name}/${direct}`];

    for (const candidate of candidates) {
      const existing = this.viewIds.get(candidate);
      if (existing) return existing;
    }

    for (const candidate of candidates) {
      const metadata = this.metadataKeyFor(candidate);
      if (metadata === undefined) continue;

      // A reference with no reported snapshot establishes a package, not an arbitrary one
      // of several peer variants. Preserve a separate unknown-adjacency view.

      const id = this.register(candidate, false, metadata);
      this.builder.nodes.get(id)!.attributes!["pnpm:snapshotMissing"] = true;
      return id;
    }

    return undefined;
  }

  viewIdFor(key: string): string | undefined {
    return this.viewIds.get(key);
  }

  hasMissingMetadata(viewId: string): boolean {
    return this.missingMetadata.has(viewId);
  }

  metadataForSnapshot(key: string): NpmRecord {
    const metadataKey = this.metadataKeyFor(key);
    return metadataKey === undefined ? {} : readPnpmRecord(this.packages[metadataKey]);
  }
}

export function readPnpmRecord(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a pnpm lockfile record");
  return value as NpmRecord;
}

export function readPnpmDependencyReference(value: unknown): {
  version: string;
  specifier?: string;
} {
  if (typeof value === "string") return { version: value };
  const ref = readPnpmRecord(value);
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
