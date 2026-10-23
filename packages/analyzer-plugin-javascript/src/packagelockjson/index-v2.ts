import { dirname, join, normalize, relative } from "node:path/posix";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import { npmResolutionCandidates } from "../npm-resolution.ts";
import {
  NpmGraphV2,
  addManifestObservation,
  dependencyScopes,
  loadNpmManifest,
  type NpmProject,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { extractPackageName } from "./lockfile.ts";

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "packagelockjson",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(
      this,
      codebase,
      "**/{package-lock.json,npm-shrinkwrap.json}",
      options.ignore,
    );
  },
  extractFile: async (file, _options, context) => {
    const lock: unknown = JSON.parse(await readNormalizedTextFile(file));
    if (lock === null || typeof lock !== "object" || Array.isArray(lock))
      throw new Error("Expected an npm lockfile object");
    const document = lock as NpmRecord;
    const version = document.lockfileVersion ?? 1;
    if (version !== 1 && version !== 2 && version !== 3)
      throw new Error(`Unsupported npm lockfile version: ${JSON.stringify(version)}`);
    const builder = new NpmGraphV2(context, "packagelockjson");
    const liveManifests = new NpmGraphV2(context, "packagejson", "declared");
    liveManifests.sourceFiles.clear();
    builder.attributes["npm:lockfileVersion"] = version;
    const records = version === 1 ? legacyRecords(document) : object(document.packages);
    if (version !== 1 && document.packages === undefined)
      throw new Error("npm lockfile is missing its packages table");
    const workspace = new Map<string, NpmProject>();
    const targets = new Map<string, string>();
    const lockDirectory = dirname(file);
    const relativeDirectory = dirname(context.relativeFile);

    // Build every native location before resolving any declaration. Input ordering must not
    // determine whether a later package or workspace can be referenced.
    for (const [location, metadata] of Object.entries(records)) {
      if (location !== "" && location.split("/").includes("node_modules")) continue;
      const manifestFile = join(lockDirectory, location, "package.json");
      const loaded = await loadNpmManifest(manifestFile, metadata, builder);
      const definitionFile = loaded.available
        ? join(relativeDirectory, location, "package.json")
        : `${context.relativeFile}#packages/${encodeURIComponent(location)}`;
      if (loaded.available) builder.sourceFiles.add(definitionFile);
      const locked = {
        ...metadata,
        ...(location === "" &&
          metadata.name === undefined &&
          typeof document.name === "string" && { name: document.name }),
        ...(location === "" &&
          metadata.version === undefined &&
          typeof document.version === "string" && { version: document.version }),
      };
      const drift = version !== 1 && loaded.available && manifestDrift(locked, loaded.manifest);
      const project = builder.addProject(
        location,
        definitionFile,
        drift ? locked : loaded.manifest,
        loaded.available || version !== 1,
      );
      if (drift) {
        builder.result.issues.push({
          code: "npm.manifest_lock_mismatch",
          severity: "WARNING",
          file: definitionFile,
          message:
            "The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations",
        });
        addManifestObservation(liveManifests, location, definitionFile, loaded.manifest);
      }
      workspace.set(location, project);
      targets.set(location, project.consumer);
    }
    if (!workspace.has("")) {
      const fallback = {
        ...(typeof document.name === "string" && { name: document.name }),
        ...(typeof document.version === "string" && { version: document.version }),
      };
      const loaded = await loadNpmManifest(join(lockDirectory, "package.json"), fallback, builder);
      const definition = loaded.available
        ? join(relativeDirectory, "package.json")
        : context.relativeFile;
      if (loaded.available) builder.sourceFiles.add(definition);
      const project = builder.addProject("", definition, loaded.manifest, loaded.available);
      workspace.set("", project);
      targets.set("", project.consumer);
    }
    for (const [location, metadata] of Object.entries(records)) {
      if (!location.split("/").includes("node_modules") || metadata.link === true) continue;
      const name = extractPackageName(location);
      if (!name) throw new Error(`Cannot identify npm package at '${location}'`);
      const id = builder.addPackage(`package:${JSON.stringify(location)}`, name, metadata);
      builder.nodes.get(id)!.locator = location;
      targets.set(location, id);
    }
    const follow = (location: string): string | undefined => {
      const visited = new Set<string>();
      let candidate = location;
      while (records[candidate]?.link === true) {
        if (visited.has(candidate)) throw new Error(`Cyclic npm workspace links at '${candidate}'`);
        visited.add(candidate);
        const destination = records[candidate]?.resolved;
        if (typeof destination !== "string") return undefined;
        candidate = normalize(destination.replace(/^file:/, ""));
        if (candidate === ".") candidate = "";
      }
      return targets.get(candidate);
    };
    const resolveDependency = (caller: string, name: string): string | undefined => {
      for (const candidate of npmResolutionCandidates(caller, name)) {
        if (!Object.hasOwn(records, candidate)) continue;
        return follow(candidate); // An existing unresolved nearer location must not fall through.
      }
      return undefined;
    };
    const declarations = (
      from: string,
      record: NpmRecord,
      caller: string,
      consumer: boolean,
      onlyScope?: string,
    ) => {
      for (const declaration of dependencyScopes(record)) {
        if (onlyScope !== undefined && declaration.scope !== onlyScope) continue;
        const target = resolveDependency(caller, declaration.name);
        const peer = declaration.scope === "peerDependencies";
        const excluded =
          declaration.excluded || (consumer && declaration.scope === "devDependencies");
        // package-lock records declarations and placement, but not a pnpm-style explicit peer
        // binding. Keep the lookup candidate without asserting that peer installation was selected.
        const optionalMissing = declaration.optional && target === undefined;
        const selection =
          excluded || (peer && optionalMissing)
            ? "excluded"
            : peer ||
                optionalMissing ||
                ((version === 1 || !Object.hasOwn(records, caller)) && workspace.has(caller))
              ? "unknown"
              : "selected";
        builder.dependency(
          from,
          declaration.name,
          declaration.specifier,
          declaration.scope,
          target,
          {
            selection,
            optional: declaration.optional,
            ...((peer || excluded || optionalMissing) && { status: "declared" as const }),
            ...(peer && {
              attributes: { "npm:peerBinding": target ? "lookup-candidate" : "not-reported" },
            }),
          },
        );
      }
    };
    for (const [location, project] of workspace) {
      declarations(project.consumer, project.manifest, location, true);
      for (const scope of NPM_DEPENDENCY_SCOPES) {
        const entry = builder.addRoot(project, scope);
        declarations(entry, project.manifest, location, false, scope);
      }
    }
    for (const [location, record] of Object.entries(records)) {
      if (!location.split("/").includes("node_modules") || record.link === true) continue;
      declarations(targets.get(location)!, record, location, true);
    }
    // Keep native lockfile placement and production/development flags on views. No filtering is
    // based on this machine's OS, CPU, libc, or an assumed deployment environment.
    builder.attributes["npm:sourceRoot"] = relative(
      context.codebasePath.replaceAll("\\", "/"),
      lockDirectory,
    );
    return liveManifests.result.subprojects.length > 0
      ? mergeResultsV2([builder.finish(), liveManifests.finish()])
      : builder.finish();
  },
});

function object(value: unknown): Record<string, NpmRecord> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an npm packages/dependencies table");
  for (const [name, record] of Object.entries(value)) {
    if (record === null || typeof record !== "object" || Array.isArray(record))
      throw new Error(`Invalid npm package record: ${name}`);
  }
  return value as Record<string, NpmRecord>;
}

/** Convert the native v1 placement tree to locations, never a PURL union. */
function legacyRecords(document: NpmRecord): Record<string, NpmRecord> {
  const records: Record<string, NpmRecord> = {};
  const visit = (dependencies: unknown, parent: string) => {
    for (const [name, entry] of Object.entries(object(dependencies ?? {}))) {
      const location = join(parent, "node_modules", name);
      const { dependencies: nested, requires, ...metadata } = entry;
      let alias: NpmRecord = {};
      if (typeof metadata.version === "string" && metadata.version.startsWith("npm:")) {
        const target = metadata.version.slice(4);
        const separator = target.indexOf("@", target.startsWith("@") ? target.indexOf("/") + 1 : 0);
        if (separator <= 0) throw new Error(`Invalid legacy npm alias: ${metadata.version}`);
        alias = {
          name: target.slice(0, separator),
          version: target.slice(separator + 1),
          "npm:aliasVersion": metadata.version,
        };
      }
      Object.defineProperty(records, location, {
        value: { ...metadata, ...alias, dependencies: requires ?? {} },
        enumerable: true,
      });
      visit(nested, location);
    }
  };
  visit(document.dependencies, "");
  return records;
}

function manifestDrift(locked: NpmRecord, current: NpmRecord): boolean {
  for (const key of ["name", "version"]) {
    if (locked[key] !== undefined && locked[key] !== current[key]) return true;
  }
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };
  return [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta"].some(
    (scope) =>
      JSON.stringify(normalize(locked[scope] ?? {})) !==
      JSON.stringify(normalize(current[scope] ?? {})),
  );
}
