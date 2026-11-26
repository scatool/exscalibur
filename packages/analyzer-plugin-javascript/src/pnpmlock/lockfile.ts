import { parseAllDocuments } from "yaml";

/**
 * Base lockfile structure shared by all versions
 */
interface PnpmLockfileBase extends PnpmImporter {
  lockfileVersion: string | number;
  /** Absent in single-project lockfiles before v9, which list dependencies at the top level */
  importers?: Record<string, PnpmImporter>;
}

/**
 * Lockfile v6 and earlier format
 * - packages section contains both metadata AND dependency relationships
 * - package keys may include peer dependency suffixes
 */
export interface PnpmLockfileV6 extends PnpmLockfileBase {
  packages?: Record<string, PnpmPackageEntry>;
}

/**
 * Lockfile v9+ format
 * - packages section contains only metadata (resolution, integrity, etc.)
 * - snapshots section contains dependency relationships
 * - snapshot keys include peer dependency suffixes
 */
export interface PnpmLockfileV9 extends PnpmLockfileBase {
  packages?: Record<string, PnpmPackageMetadata>;
  snapshots?: Record<string, PnpmSnapshotEntry>;
}

/**
 * Union type for all lockfile versions
 */
export type PnpmLockfile = PnpmLockfileV6 | PnpmLockfileV9;

export interface PnpmImporter {
  dependencies?: Record<string, PnpmDependencyRef>;
  devDependencies?: Record<string, PnpmDependencyRef>;
  optionalDependencies?: Record<string, PnpmDependencyRef>;
  peerDependencies?: Record<string, PnpmDependencyRef>;
}

/** Lockfile v6+ stores an object, v5 only the resolved version */
export type PnpmDependencyRef = string | { specifier: string; version: string };

/**
 * How package keys are written:
 * - "slash": lockfile v5 (`/name/version_peers`)
 * - "at": lockfile v6 (`/name@version(peers)`) and v9+ (`name@version`)
 */
export type PnpmKeyFormat = "slash" | "at";

export function getKeyFormat(lockfile: PnpmLockfile): PnpmKeyFormat {
  const version = Number.parseFloat(String(lockfile.lockfileVersion));
  return version < 6 ? "slash" : "at";
}

/**
 * Importers of the lockfile keyed by their path relative to the lockfile. Single-project
 * lockfiles before v9 have no `importers` section; their root project is returned as ".".
 */
export function getImporters(lockfile: PnpmLockfile): Record<string, PnpmImporter> {
  if (lockfile.importers) return lockfile.importers;
  const { dependencies, devDependencies, optionalDependencies } = lockfile;
  if (!dependencies && !devDependencies && !optionalDependencies) return {};
  return { ".": { dependencies, devDependencies, optionalDependencies } };
}

/**
 * Package metadata (used in v9+ packages section, and v6 packages with relationships)
 */
export interface PnpmPackageMetadata {
  /** Only set for non-registry packages (git, tarball) before lockfile v9 */
  name?: string;
  /** Only set for non-registry packages (git, tarball), whose key holds a URL instead */
  version?: string;
  resolution?: {
    integrity?: string;
    tarball?: string;
    commit?: string;
    repo?: string;
    type?: string;
    /** Path of a local `file:` directory dependency, relative to the lockfile */
    directory?: string;
  };
  engines?: Record<string, string>;
  cpu?: string[];
  os?: string[];
}

/**
 * Package entry with relationships (used in v6 and earlier packages section)
 */
export interface PnpmPackageEntry extends PnpmPackageMetadata {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface PnpmSnapshotEntry {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  transitivePeerDependencies?: string[];
  optional?: boolean;
}

export interface ParsedPnpmLockfile {
  lockfile: PnpmLockfile;
  /** 1-indexed line at which the lockfile's YAML document starts within the file */
  startLine: number;
}

/**
 * Importer keys that only appear in pnpm's "env" document, which pins the package manager
 * itself (and config dependencies) rather than describing the project's dependencies.
 */
const ENV_IMPORTER_KEYS = ["packageManagerDependencies", "configDependencies"];

const DEPENDENCY_IMPORTER_KEYS = ["dependencies", "devDependencies", "optionalDependencies"];

/** An env document has importers with env keys and none with regular dependencies. */
function isEnvDocument(lockfile: PnpmLockfile): boolean {
  const importers = Object.values(lockfile.importers ?? {}).filter(
    (importer) => importer && typeof importer === "object",
  );
  const hasKey = (keys: string[]) =>
    importers.some((importer) => keys.some((key) => key in importer));
  return hasKey(ENV_IMPORTER_KEYS) && !hasKey(DEPENDENCY_IMPORTER_KEYS);
}

/**
 * Parse a pnpm-lock.yaml file.
 *
 * Recent pnpm versions write multiple YAML documents into the file: an "env" document that
 * locks the package manager (`packageManagerDependencies`) followed by the regular lockfile.
 * Only the regular lockfile describes the project's dependencies, so the env document is
 * skipped. A file consisting solely of an env document yields a lockfile without packages
 * whose root importer has no dependencies.
 */
export function parsePnpmLockfile(content: string): ParsedPnpmLockfile {
  let envVersion: string | number | undefined;
  let result: ParsedPnpmLockfile | undefined;

  for (const document of parseAllDocuments(content)) {
    const error = document.errors[0];
    if (error) throw error;

    const lockfile = document.toJS() as PnpmLockfile | null;
    if (!lockfile || typeof lockfile !== "object") continue;

    if (isEnvDocument(lockfile)) {
      envVersion ??= lockfile.lockfileVersion;
      continue;
    }

    const offset = document.contents?.range[0] ?? 0;
    // The last regular document wins, matching how pnpm appends the lockfile after the env one
    result = { lockfile, startLine: content.substring(0, offset).split("\n").length };
  }

  if (result) return result;
  if (envVersion !== undefined) {
    // Only the package manager is locked: the project exists but has no dependencies
    return { lockfile: { lockfileVersion: envVersion, importers: { ".": {} } }, startLine: 1 };
  }
  throw new Error("pnpm-lock.yaml does not contain a lockfile document");
}

/**
 * Extract package name and version from a pnpm package key
 * Examples:
 *   "@babel/core@7.23.9" -> { name: "@babel/core", version: "7.23.9" }
 *   "@babel/core@7.23.9(@babel/preset-env@7.23.9)" -> { name: "@babel/core", version: "7.23.9" }
 *   "/lodash@4.17.21" (v6) -> { name: "lodash", version: "4.17.21" }
 *   "/@babel/core/7.23.9_peer@1.0.0" (v5, "slash" format) -> { name: "@babel/core", version: "7.23.9" }
 *   "a@git+ssh://git@github.com/u/a.git#abc" -> { name: "a", version: "git+ssh://git@github.com/u/a.git#abc" }
 */
export function parsePackageKey(
  key: string,
  format: PnpmKeyFormat = "at",
): { name: string; version: string } | null {
  const path = key.startsWith("/") ? key.substring(1) : key;

  if (format === "slash") {
    // Non-registry packages are keyed by a host path and carry name/version in their entry
    if (path === key) return null;
    const segments = path.split("/");
    const name = segments.splice(0, path.startsWith("@") ? 2 : 1).join("/");
    const version = stripPeerDepSuffix(segments.join("/"), format);
    return name && version ? { name, version } : null;
  }

  // The first @ after a possible scope separates name and version; versions of non-registry
  // packages are URLs that may contain further @ characters
  const atIndex = path.indexOf("@", 1);
  if (atIndex <= 0) return null;

  const name = path.substring(0, atIndex);
  const version = stripPeerDepSuffix(path.substring(atIndex + 1), format);
  return version ? { name, version } : null;
}

/**
 * Strip peer dependency suffix from a version or package key
 * E.g., "19.2.0(react@19.2.0)" -> "19.2.0", or "1.7.0_react@18.3.1" -> "1.7.0" in lockfile v5
 */
export function stripPeerDepSuffix(version: string, format: PnpmKeyFormat = "at"): string {
  const suffixIndex = version.indexOf(format === "slash" ? "_" : "(");
  return suffixIndex > 0 ? version.substring(0, suffixIndex) : version;
}

/**
 * Package keys a dependency reference may point to, most specific first.
 * A reference is either a version of `depName` or, for aliases and non-registry packages
 * before v9, a complete package key.
 */
export function getPackageKeyCandidates(
  depName: string,
  ref: string,
  format: PnpmKeyFormat,
): string[] {
  const candidates: string[] = [];
  for (const candidate of new Set([ref, stripPeerDepSuffix(ref, format)])) {
    if (format === "slash") {
      candidates.push(`/${depName}/${candidate}`, candidate);
    } else {
      candidates.push(`${depName}@${candidate}`, `/${depName}@${candidate}`, candidate);
    }
  }
  return candidates;
}

/**
 * Index the line numbers (1-indexed) at which package keys first appear.
 * `startLine` skips preceding YAML documents of a multi-document file. Indexing starts at the
 * packages section, as earlier sections (e.g. patchedDependencies) use identical keys.
 */
export function buildLineIndex(content: string, startLine = 1): Map<string, number> {
  const index = new Map<string, number>();
  const lines = content.split("\n");
  const packagesLine = lines.findIndex((line, i) => i >= startLine - 1 && /^packages:/.test(line));

  for (let i = Math.max(packagesLine, startLine - 1); i < lines.length; i++) {
    const line = lines[i]!.trim();
    const quote = line[0] === "'" || line[0] === '"' ? line[0] : undefined;

    let key: string | undefined;
    if (quote) {
      const end = line.indexOf(`${quote}:`, 1);
      if (end > 0) key = line.substring(1, end);
    } else if (line.endsWith(":")) {
      key = line.substring(0, line.length - 1);
    } else {
      // Unquoted keys may contain colons (URLs, file:), but never one followed by a space
      const end = line.indexOf(": ");
      if (end > 0) key = line.substring(0, end);
    }

    if (key && !index.has(key)) index.set(key, i + 1);
  }

  return index;
}
