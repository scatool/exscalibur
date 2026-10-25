import { dirname, join, normalize } from "node:path/posix";
import { parse as parseYaml } from "yaml";
import {
  filesExtractor,
  mergeResults,
  readTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import { NpmGraph, json, type NpmProject, type NpmRecord } from "../npm-graph.ts";
import { addCurrentManifestObservation, loadNpmManifest, table } from "../npm-manifest.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { PnpmSnapshotIndex, readPnpmRecord, readPnpmDependencyReference } from "./snapshots.ts";

type PnpmProjects = Map<string, { project: NpmProject; importer: NpmRecord }>;
type ResolveDependency = (name: string, reference: string, owner: string) => string | undefined;

export const extractor = filesExtractor<JavaScriptOptions>({
  name: "pnpmlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/pnpm-lock.yaml", options.ignore);
  },
  extractFile: async (file, _options, context) => {
    const document = readPnpmRecord(parseYaml(await readTextFile(file)));
    const version =
      typeof document.lockfileVersion === "number"
        ? document.lockfileVersion
        : typeof document.lockfileVersion === "string"
          ? Number.parseFloat(document.lockfileVersion)
          : Number.NaN;
    if (
      !Number.isFinite(version) ||
      version < 5 ||
      (version >= 7 && version < 9) ||
      version >= 10
    ) {
      throw new Error(
        `Unsupported pnpm lockfile version: ${JSON.stringify(document.lockfileVersion)}`,
      );
    }

    const lockedObservation = new NpmGraph(context, "pnpmlock");
    const currentDeclarations = new NpmGraph(context, "packagejson", "declared");
    currentDeclarations.sourceFiles.clear();

    lockedObservation.attributes["pnpm:lockfileVersion"] = json(document.lockfileVersion);
    for (const key of [
      "settings",
      "overrides",
      "patchedDependencies",
      "packageExtensionsChecksum",
    ]) {
      if (document[key] !== undefined)
        lockedObservation.attributes[`pnpm:${key}`] = json(document[key]);
    }

    // Preserve native peer/patch contexts before any importer or package binding can refer to them.
    const snapshotIndex = new PnpmSnapshotIndex(lockedObservation, document, version);

    const missingImporters = version >= 9 && document.importers == null;
    const importers =
      document.importers === undefined && version < 9
        ? { ".": document }
        : table(document, "importers");
    if (missingImporters) {
      lockedObservation.rootCompleteness = "unknown";
      lockedObservation.result.issues.push({
        code: "pnpm.importers_missing",
        severity: "WARNING",
        file: context.relativeFile,
        message: "The v9 importer table is missing; native project roots cannot be established",
      });
      const loaded = await loadNpmManifest(
        join(dirname(file), "package.json"),
        {},
        lockedObservation,
      );
      if (loaded.available)
        addCurrentManifestObservation(
          currentDeclarations,
          ".",
          join(dirname(context.relativeFile), "package.json"),
          loaded.manifest,
        );
    }

    // Locked importer requests and current declarations are separate observations.
    const projects = new Map<string, { project: NpmProject; importer: NpmRecord }>();
    for (const [location, value] of Object.entries(importers)) {
      const importer = readPnpmRecord(value);
      const loaded = await loadNpmManifest(
        join(dirname(file), location, "package.json"),
        {},
        lockedObservation,
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
            const ref = readPnpmDependencyReference(value);
            const original = table(importer, "specifiers")[name];
            return [name, ref.specifier ?? (typeof original === "string" ? original : ref.version)];
          }),
        );
      }

      const project = lockedObservation.addProject(location, definitionFile, specs, true);
      projects.set(normalize(location), { project, importer });

      if (loaded.available) {
        lockedObservation.sourceFiles.add(definitionFile);
        // Importers encode a selected dependency observation, not necessarily every current
        // manifest declaration (notably peer requirements). Keep the source declaration separately.
        addCurrentManifestObservation(
          currentDeclarations,
          location,
          definitionFile,
          loaded.manifest,
        );
      }
    }

    const resolveDependency: ResolveDependency = (name, reference, owner) => {
      if (reference.startsWith("link:")) {
        return projects.get(normalize(join(owner, reference.slice(5))))?.project.consumer;
      }

      return snapshotIndex.resolvePackage(name, reference);
    };

    addImporterDependencies(lockedObservation, projects, snapshotIndex, resolveDependency);
    addSnapshotDependencies(lockedObservation, snapshotIndex, resolveDependency);

    return currentDeclarations.result.subprojects.length > 0
      ? mergeResults([lockedObservation.finish(), currentDeclarations.finish()])
      : lockedObservation.finish();
  },
});

/** Importer roots retain scopes; consumer views exclude development dependencies. */
function addImporterDependencies(
  lockedObservation: NpmGraph,
  projects: PnpmProjects,
  snapshotIndex: PnpmSnapshotIndex,
  resolveDependency: ResolveDependency,
): void {
  for (const [location, { project, importer }] of projects) {
    for (const scope of NPM_DEPENDENCY_SCOPES) {
      const root = lockedObservation.addRoot(project, scope);
      for (const [name, value] of Object.entries(table(importer, scope))) {
        const reference = readPnpmDependencyReference(value);
        const target = resolveDependency(name, reference.version, location);
        const specifier = table(project.manifest, scope)[name] as string;

        const overridden =
          scope === "dependencies" && Object.hasOwn(table(importer, "optionalDependencies"), name);
        const optional = scope === "optionalDependencies";
        const selection = overridden
          ? "excluded"
          : (optional && target === undefined) ||
              (target !== undefined && snapshotIndex.hasMissingMetadata(target))
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

        lockedObservation.dependency(root, name, specifier, scope, target, options);
        lockedObservation.dependency(project.consumer, name, specifier, scope, target, {
          ...options,
          selection: overridden || scope === "devDependencies" ? "excluded" : options.selection,
        });
      }
    }
  }
}

/** Native snapshot bindings and unbound peer declarations remain distinct observations. */
function addSnapshotDependencies(
  lockedObservation: NpmGraph,
  snapshotIndex: PnpmSnapshotIndex,
  resolveDependency: ResolveDependency,
): void {
  for (const [key, value] of Object.entries(snapshotIndex.snapshots)) {
    const snapshot = readPnpmRecord(value);
    const from = snapshotIndex.viewIdFor(key)!;
    const metadata = snapshotIndex.metadataForSnapshot(key);

    const peers = table(metadata, "peerDependencies");
    const peerMeta = table(metadata, "peerDependenciesMeta");
    const bound = new Set<string>();

    for (const scope of NPM_DEPENDENCY_SCOPES) {
      // In legacy locks the package metadata and snapshot share a record. Its peer ranges
      // are declarations; actual peer bindings are in dependencies/optionalDependencies.
      if (scope === "peerDependencies") continue;

      for (const [name, value] of Object.entries(table(snapshot, scope))) {
        const reference = readPnpmDependencyReference(value);
        // Snapshot links are relative to the lockfile root, unlike importer-relative links.
        const target = resolveDependency(name, reference.version, ".");
        const peer = Object.hasOwn(peers, name);
        const optional =
          scope === "optionalDependencies" || (peer && table(peerMeta, name).optional === true);
        const original = peers[name];
        const selection =
          scope === "devDependencies"
            ? "excluded"
            : (optional && target === undefined) ||
                (target !== undefined && snapshotIndex.hasMissingMetadata(target))
              ? "unknown"
              : "selected";

        lockedObservation.dependency(
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

    // Unbound peer requirements are declarations, never inferred package edges.
    for (const [name, specifier] of Object.entries(peers)) {
      if (bound.has(name)) continue;
      if (typeof specifier !== "string")
        throw new Error(`Invalid pnpm peer declaration for '${name}'`);

      const optional = table(peerMeta, name).optional === true;
      lockedObservation.dependency(from, name, specifier, "peerDependencies", undefined, {
        optional,
        status: "declared",
        selection: optional ? "excluded" : "unknown",
      });
    }
  }
}
