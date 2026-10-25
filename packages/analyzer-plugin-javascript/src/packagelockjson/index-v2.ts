import { resolve } from "node:path";
import { dirname, join, relative } from "node:path/posix";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import { NpmGraphV2, dependencyScopes, type NpmRecord } from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { extractPackageName } from "./lockfile.ts";
import { createPlacementResolver } from "./placement.ts";
import { isWithinDirectory, registerLockProjects } from "./projects.ts";

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
    if (lock === null || typeof lock !== "object" || Array.isArray(lock)) {
      throw new Error("Expected an npm lockfile object");
    }

    const document = lock as NpmRecord;
    const version = document.lockfileVersion ?? 1;
    if (version !== 1 && version !== 2 && version !== 3) {
      throw new Error(`Unsupported npm lockfile version: ${JSON.stringify(version)}`);
    }

    const lockedObservation = new NpmGraphV2(context, "packagelockjson");
    const currentManifestObservation = new NpmGraphV2(context, "packagejson", "declared");
    currentManifestObservation.sourceFiles.clear();
    lockedObservation.attributes["npm:lockfileVersion"] = version;

    const packagesByLocation =
      version === 1 ? flattenLegacyPlacements(document) : readPackageRecords(document.packages);
    if (version !== 1 && document.packages === undefined) {
      throw new Error("npm lockfile is missing its packages table");
    }

    for (const [location, record] of Object.entries(packagesByLocation)) {
      if (record.link !== undefined && typeof record.link !== "boolean") {
        throw new Error(`Invalid npm link flag at '${location}'`);
      }
    }

    // Legacy local entries without artifact metadata do not establish a source-local
    // project context. A placement lookup alone cannot establish a local source binding.
    const legacyLocalLocations = new Set(
      version === 1
        ? Object.entries(packagesByLocation)
            .filter(
              ([, record]) =>
                typeof record.version === "string" &&
                /^(?:file:|link:)/.test(record.version) &&
                record.resolved === undefined &&
                record.integrity === undefined,
            )
            .map(([location]) => location)
        : [],
    );

    // Complete both project and package placement indexes before resolving any links.
    const lockDirectory = dirname(file);
    const { projectsByLocation, projectsWithInvalidDeclarations, viewsByLocation } =
      await registerLockProjects(
        lockDirectory,
        context,
        { document, version, packagesByLocation },
        lockedObservation,
        currentManifestObservation,
      );

    for (const [location, metadata] of Object.entries(packagesByLocation)) {
      if (!location.split("/").includes("node_modules") || metadata.link === true) continue;

      const name = extractPackageName(location);
      if (!name) throw new Error(`Cannot identify npm package at '${location}'`);

      const id = lockedObservation.addPackage(
        `package:${JSON.stringify(location)}`,
        name,
        metadata,
        !legacyLocalLocations.has(location),
      );
      lockedObservation.nodes.get(id)!.locator = location;
      viewsByLocation.set(location, id);
    }

    const { followWorkspaceLink, resolveDependency } = createPlacementResolver(
      packagesByLocation,
      viewsByLocation,
      lockDirectory,
    );

    // Lock records are evidence even when no root currently references them.
    for (const [location, record] of Object.entries(packagesByLocation)) {
      if (record.link !== true || followWorkspaceLink(location) !== undefined) continue;
      lockedObservation.rootCompleteness = "unknown";
      lockedObservation.result.issues.push({
        code: "npm.link_target_missing",
        severity: "WARNING",
        file: context.relativeFile,
        message: `The target of npm link '${location}' is not recorded; project enumeration remains unknown`,
      });
    }

    const addDependencies = (
      from: string,
      record: NpmRecord,
      caller: string,
      isDependencyConsumer: boolean,
      onlyScope?: string,
    ) => {
      // Native virtual loading does not establish bindings for sources outside the lock root.
      // Retain recorded lexical candidates without asserting a selected installation context.
      const externalSource = !isWithinDirectory(
        resolve(lockDirectory),
        resolve(lockDirectory, caller),
      );

      for (const declaration of dependencyScopes(record)) {
        if (onlyScope !== undefined && declaration.scope !== onlyScope) continue;

        const target = resolveDependency(caller, declaration.name);
        const peer = declaration.scope === "peerDependencies";
        const excluded =
          declaration.excluded || (isDependencyConsumer && declaration.scope === "devDependencies");

        // package-lock records declarations and placement, but not a pnpm-style explicit peer
        // binding. Keep the lookup candidate without asserting that peer installation was selected.
        const optionalMissing = declaration.optional && target === undefined;
        let selection: "selected" | "excluded" | "unknown" = "selected";
        if (excluded || (peer && optionalMissing)) {
          selection = "excluded";
        } else if (
          peer ||
          externalSource ||
          optionalMissing ||
          legacyLocalLocations.has(caller) ||
          ((version === 1 || !Object.hasOwn(packagesByLocation, caller)) &&
            projectsByLocation.has(caller))
        ) {
          selection = "unknown";
        }

        lockedObservation.dependency(
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

    if (
      version === 1 &&
      (legacyLocalLocations.size > 0 ||
        [...projectsByLocation.values()].some((project) => {
          const declarations = project.manifest.workspaces;
          return Array.isArray(declarations)
            ? declarations.length > 0
            : declarations !== undefined && declarations !== null;
        }))
    ) {
      lockedObservation.rootCompleteness = "unknown";
      lockedObservation.result.issues.push({
        code: "npm.legacy_local_context_unknown",
        severity: "WARNING",
        file: context.relativeFile,
        message:
          "Lockfile version 1 does not establish workspace/local project roots or source-relative dependency contexts; local lookup candidates remain uncertain",
      });
    }

    // Project roots retain each native scope; dependency-consumer views exclude dev edges.
    for (const [location, project] of projectsByLocation) {
      if (projectsWithInvalidDeclarations.has(project.consumer)) {
        for (const scope of NPM_DEPENDENCY_SCOPES) lockedObservation.addRoot(project, scope);
        continue;
      }

      addDependencies(project.consumer, project.manifest, location, true);
      for (const scope of NPM_DEPENDENCY_SCOPES) {
        const entry = lockedObservation.addRoot(project, scope);
        addDependencies(entry, project.manifest, location, false, scope);
      }
    }

    for (const [location, record] of Object.entries(packagesByLocation)) {
      if (!location.split("/").includes("node_modules") || record.link === true) continue;
      addDependencies(viewsByLocation.get(location)!, record, location, true);
    }

    // Keep native lockfile placement and production/development flags on views. No filtering is
    // based on this machine's OS, CPU, libc, or an assumed deployment environment.
    lockedObservation.attributes["npm:sourceRoot"] = relative(
      context.codebasePath.replaceAll("\\", "/"),
      lockDirectory,
    );

    return currentManifestObservation.result.subprojects.length > 0
      ? mergeResultsV2([lockedObservation.finish(), currentManifestObservation.finish()])
      : lockedObservation.finish();
  },
});

function readPackageRecords(value: unknown): Record<string, NpmRecord> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an npm packages/dependencies table");
  }

  for (const [name, record] of Object.entries(value)) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid npm package record: ${name}`);
    }
  }

  return value as Record<string, NpmRecord>;
}

/** Convert the native v1 placement tree to locations, never a PURL union. */
function flattenLegacyPlacements(document: NpmRecord): Record<string, NpmRecord> {
  const records: Record<string, NpmRecord> = {};
  const visit = (dependencies: unknown, parent: string) => {
    for (const [name, entry] of Object.entries(readPackageRecords(dependencies ?? {}))) {
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
