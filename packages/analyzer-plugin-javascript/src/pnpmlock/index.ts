import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Issue,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { dirname, join } from "node:path/posix";
import {
  buildLineIndex,
  getImporters,
  getKeyFormat,
  getPackageKeyCandidates,
  parsePackageKey,
  parsePnpmLockfile,
  resolveInside,
  type PnpmKeyFormat,
  type PnpmLockfile,
  type PnpmLockfileV9,
  type PnpmPackageEntry,
  type PnpmPackageMetadata,
  stripPeerDepSuffix,
} from "./lockfile.ts";
import {
  createNpmPurl,
  getProjectName,
  NPM_DEPENDENCY_SCOPES,
  readPackageJson,
} from "../npm-utils.ts";
import type { JavaScriptOptions } from "../options.ts";
import { optionSchema } from "../options.ts";

type PackageMap = Map<string, { purl: string; evidence: Set<string> }>;
type RelationshipsMap = Map<string, Set<string>>;
type DependencyGroups = Partial<
  Record<"dependencies" | "devDependencies" | "optionalDependencies", Record<string, string>>
>;

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: "pnpmlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    await scanAndMarkFiles(this, codebase, "**/pnpm-lock.yaml", options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const lockfileContent = await readNormalizedTextFile(file);
    const { lockfile, startLine } = parsePnpmLockfile(lockfileContent);
    const issues: Issue[] = [];
    // Paths of the lockfile are untrusted, files outside of its directory are not read
    const reportOutside = (path: string) =>
      issues.push({
        code: "pnpmlock.path_outside_lockfile_directory",
        message: `Skipped package.json of "${path}": the path is outside of the directory of the lockfile`,
        severity: "WARNING",
        file,
      });
    const resolver = await PackageResolver.create(lockfile, dir, reportOutside);
    const lineIndex = buildLineIndex(lockfileContent, startLine);
    const importers = Object.entries(getImporters(lockfile));

    // Read the package.json of every importer (workspace package). Their PURLs are needed up
    // front so that workspace dependencies (link:) can be resolved by the linked directory.
    // Name and version are optional: private packages, especially workspace roots, often have
    // neither.
    const workspacePurls = new Map<string, string>();
    const importerInfos = await Promise.all(
      importers.map(async ([importerPath, importer]) => {
        const importerDir = resolveInside(dir, importerPath);
        if (!importerDir) {
          reportOutside(importerPath);
          return null;
        }
        const packageJsonPath = join(importerDir, "package.json");
        const packageInfo = await readPackageJson(packageJsonPath);
        const purl = packageInfo
          ? createNpmPurl(getProjectName(packageInfo, importerDir), packageInfo.version)
          : undefined;
        if (purl) workspacePurls.set(importerDir, purl);
        return { importer, importerDir, packageJsonPath, purl };
      }),
    );

    // Process importers to create subprojects
    for (const info of importerInfos) {
      if (!info?.purl) continue;
      const { importer, importerDir, packageJsonPath, purl } = info;

      // Map each dependency type to resolved versions
      const scopes: DependencyScope[] = [];

      for (const scopeName of NPM_DEPENDENCY_SCOPES) {
        const depsInScope: string[] = [];
        const importerDeps = importer?.[scopeName];
        if (!importerDeps || typeof importerDeps !== "object") continue;

        for (const [depName, depRef] of Object.entries(importerDeps)) {
          // Lockfile v6+ stores { specifier, version }, v5 only the version
          const version = typeof depRef === "string" ? depRef : depRef?.version;
          if (typeof version !== "string") continue;

          if (version.startsWith("link:")) {
            // Include workspace packages, which are linked by their directory (the dependency
            // may be installed under an alias), and skip links to anything else
            const workspacePurl = workspacePurls.get(
              join(importerDir, version.substring("link:".length)),
            );
            if (workspacePurl) depsInScope.push(workspacePurl);
            continue;
          }

          depsInScope.push(resolver.resolve(depName, version));
        }

        if (depsInScope.length > 0) {
          scopes.push({ scope: scopeName, packages: depsInScope });
        }
      }

      subprojects.push({
        purl,
        definitionFile: packageJsonPath,
        scopes,
      });
    }

    // Packages section: one entry per package. Before v9 the entries also hold the
    // dependency relationships (keys include peer dependency suffixes).
    const packages: Record<string, PnpmPackageEntry | null> = lockfile.packages ?? {};
    for (const [packageKey, packageEntry] of Object.entries(packages)) {
      const purl = resolver.purlOfKey(packageKey);
      if (!purl) continue;

      ensurePackageExists(packageMap, purl);

      const lineNumber = lineIndex.get(packageKey);
      if (lineNumber) {
        packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
      }

      if (packageEntry) {
        processDependencies(packageEntry, purl, resolver, packageMap, relationshipsMap);
      }
    }

    // Snapshots section (v9+): dependency relationships, keyed with peer dependency suffixes
    const { snapshots } = lockfile as PnpmLockfileV9;
    for (const [snapshotKey, snapshotEntry] of Object.entries(snapshots ?? {})) {
      const purl = resolver.purlOfKey(stripPeerDepSuffix(snapshotKey, resolver.format));
      if (!purl || !snapshotEntry) continue;

      processDependencies(snapshotEntry, purl, resolver, packageMap, relationshipsMap);
    }

    return buildResult(packageMap, relationshipsMap, subprojects, issues);
  },
});

function processDependencies(
  deps: DependencyGroups,
  purl: string,
  resolver: PackageResolver,
  packageMap: PackageMap,
  relationshipsMap: RelationshipsMap,
): void {
  const depTypes = ["dependencies", "devDependencies", "optionalDependencies"] as const;
  for (const depType of depTypes) {
    const depsInScope = deps[depType];
    if (!depsInScope || typeof depsInScope !== "object") continue;

    for (const [depName, depVersion] of Object.entries(depsInScope)) {
      if (typeof depVersion !== "string" || depVersion.startsWith("link:")) continue;

      const depPurl = resolver.resolve(depName, depVersion);
      addRelationship(relationshipsMap, purl, depPurl);
      ensurePackageExists(packageMap, depPurl);
    }
  }
}

/**
 * Maps package keys and dependency references of a lockfile to PURLs.
 *
 * Dependency references are looked up in the packages section rather than parsed on their own:
 * git and tarball packages are referenced by URL while their real version is only stored in
 * the package entry, and aliases reference a package under a different name.
 */
class PackageResolver {
  readonly format: PnpmKeyFormat;
  private readonly purls = new Map<string, string>();

  private constructor(format: PnpmKeyFormat) {
    this.format = format;
  }

  /**
   * @param dir directory of the lockfile, used to read local `file:` dependencies
   * @param reportOutside called for local dependencies outside of `dir`, which are not read
   */
  static async create(
    lockfile: PnpmLockfile,
    dir: string,
    reportOutside: (path: string) => void,
  ): Promise<PackageResolver> {
    const resolver = new PackageResolver(getKeyFormat(lockfile));
    const packages: Record<string, PnpmPackageMetadata | null> = lockfile.packages ?? {};

    for (const [key, entry] of Object.entries(packages)) {
      const parsed = parsePackageKey(key, resolver.format);
      const name = entry?.name ?? parsed?.name;
      if (!name) continue;

      const directory =
        entry?.resolution?.type === "directory" ? entry.resolution.directory : undefined;
      if (typeof directory === "string") {
        // Local directory (file:): the lockfile has no reliable version, so read it from the
        // package itself and fall back to a version-less PURL
        const packageDir = resolveInside(dir, directory);
        if (!packageDir) reportOutside(directory);
        const packageInfo = packageDir
          ? await readPackageJson(join(packageDir, "package.json"))
          : null;
        const version = packageInfo?.version ?? entry?.version;
        resolver.purls.set(key, createNpmPurl(name, version));
        continue;
      }

      // Non-registry packages store their real version in the entry, the key holds a URL
      const version = entry?.version ?? parsed?.version;
      if (version) resolver.purls.set(key, createNpmPurl(name, version));
    }

    return resolver;
  }

  /** PURL of a key of the packages section */
  purlOfKey(key: string): string | undefined {
    return this.purls.get(key);
  }

  /** PURL of a dependency reference, e.g. `react: 19.2.0(...)` or `alias: string-width@4.2.3` */
  resolve(depName: string, ref: string): string {
    for (const key of getPackageKeyCandidates(depName, ref, this.format)) {
      const purl = this.purls.get(key);
      if (purl) return purl;
    }

    // Not part of the packages section (e.g. an incomplete lockfile): derive it from the
    // reference, which is a package key for aliases and a plain version otherwise
    const version = stripPeerDepSuffix(ref, this.format);
    const alias =
      /^\/?@?[^@/:]/.test(version) && !/^\d/.test(version) && !version.includes(":")
        ? parsePackageKey(ref, this.format)
        : null;
    return createNpmPurl(alias?.name ?? depName, alias?.version ?? version);
  }
}
