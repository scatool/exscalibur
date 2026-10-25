import { realpath } from "node:fs/promises";
import { isAbsolute, relative as filesystemRelative, resolve, sep } from "node:path";
import { dirname, join } from "node:path/posix";
import type { FileExtractionContextV2 } from "@scatool/analyzer-core";
import {
  addCurrentManifestObservation,
  dependencyScopes,
  loadNpmManifest,
  type NpmGraphV2,
  type NpmProject,
  type NpmRecord,
} from "../npm-v2.ts";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";

type LockProjectInput = {
  document: NpmRecord;
  version: 1 | 2 | 3;
  packagesByLocation: Record<string, NpmRecord>;
};

/** Register source projects before dependency lookup; current declarations remain independent. */
export async function registerLockProjects(
  lockDirectory: string,
  context: FileExtractionContextV2,
  { document, version, packagesByLocation }: LockProjectInput,
  lockedObservation: NpmGraphV2,
  currentManifestObservation: NpmGraphV2,
) {
  const projectsByLocation = new Map<string, NpmProject>();
  const projectsWithInvalidDeclarations = new Set<string>();
  const viewsByLocation = new Map<string, string>();

  const relativeDirectory = dirname(context.relativeFile);
  const codebaseDirectory = await realpath(context.codebasePath);

  // A manifest must be contained both lexically and after resolving symlinks.
  // When either check fails, retain the independent lock record without reading it.
  const loadContainedManifest = async (manifestFile: string, fallback: NpmRecord) => {
    let safe = isWithinDirectory(resolve(context.codebasePath), resolve(manifestFile));
    if (safe) {
      try {
        safe = isWithinDirectory(codebaseDirectory, await realpath(manifestFile));
      } catch (error) {
        if (
          !(
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          lockedObservation.result.issues.push({
            code: "npm.manifest_unreadable",
            severity: "WARNING",
            file: context.relativeFile,
            message: "Could not resolve a local manifest path; using lockfile metadata",
          });
        }

        // Do not read content through a path whose containment could not be checked.
        return { manifest: fallback, available: false };
      }
    }

    if (!safe) {
      lockedObservation.result.issues.push({
        code: "npm.manifest_outside_codebase",
        severity: "WARNING",
        file: context.relativeFile,
        message:
          "A local manifest path leaves the scanned codebase; only recorded lock metadata is used",
      });
      return { manifest: fallback, available: false };
    }

    return loadNpmManifest(manifestFile, fallback, lockedObservation);
  };

  // Register all source projects before dependency lookup. A later workspace must be
  // available regardless of the lockfile's record order.
  for (const [location, metadata] of Object.entries(packagesByLocation)) {
    if (location !== "" && location.split("/").includes("node_modules")) continue;

    const manifestFile = join(lockDirectory, location, "package.json");
    const loaded = await loadContainedManifest(manifestFile, metadata);
    const definitionFile = loaded.available
      ? join(relativeDirectory, location, "package.json")
      : `${context.relativeFile}#packages/${encodeURIComponent(location)}`;
    if (loaded.available) lockedObservation.sourceFiles.add(definitionFile);

    const locked = {
      ...metadata,
      ...(location === "" &&
        metadata.name === undefined &&
        typeof document.name === "string" && { name: document.name }),
      ...(location === "" &&
        metadata.version === undefined &&
        typeof document.version === "string" && { version: document.version }),
    };
    const drift = version !== 1 && loaded.available && hasManifestDrift(locked, loaded.manifest);
    const project = lockedObservation.addProject(
      location,
      definitionFile,
      drift || !loaded.available ? locked : loaded.manifest,
      loaded.available || version !== 1,
    );

    if (drift) {
      lockedObservation.result.issues.push({
        code: "npm.manifest_lock_mismatch",
        severity: "WARNING",
        file: definitionFile,
        message:
          "The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations",
      });
      addCurrentManifestObservation(
        currentManifestObservation,
        location,
        definitionFile,
        loaded.manifest,
      );
    }

    projectsByLocation.set(location, project);
    viewsByLocation.set(location, project.consumer);
  }

  // Older lockfiles can omit the root record. Its current manifest contributes only
  // what can be validated independently; invalid declarations never erase lock evidence.
  if (!projectsByLocation.has("")) {
    const fallback = {
      ...(typeof document.name === "string" && { name: document.name }),
      ...(typeof document.version === "string" && { version: document.version }),
    };
    const loaded = await loadContainedManifest(join(lockDirectory, "package.json"), fallback);
    const definition = loaded.available
      ? join(relativeDirectory, "package.json")
      : context.relativeFile;
    if (loaded.available) lockedObservation.sourceFiles.add(definition);

    const project = lockedObservation.addProject("", definition, loaded.manifest, loaded.available);
    if (loaded.available) {
      try {
        dependencyScopes(loaded.manifest);
      } catch {
        addCurrentManifestObservation(currentManifestObservation, "", definition, loaded.manifest);
        project.known = false;
        lockedObservation.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";
        projectsWithInvalidDeclarations.add(project.consumer);
      }
    }

    projectsByLocation.set("", project);
    viewsByLocation.set("", project.consumer);
  }

  return { projectsByLocation, projectsWithInvalidDeclarations, viewsByLocation };
}

export function isWithinDirectory(root: string, path: string): boolean {
  const pathWithinRoot = filesystemRelative(root, path);
  return (
    !isAbsolute(pathWithinRoot) && pathWithinRoot !== ".." && !pathWithinRoot.startsWith(`..${sep}`)
  );
}

function hasManifestDrift(locked: NpmRecord, current: NpmRecord): boolean {
  for (const key of ["name", "version"]) {
    if (locked[key] !== undefined && locked[key] !== current[key]) return true;
  }

  const canonicalizeManifestValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalizeManifestValue);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonicalizeManifestValue(item)]),
      );
    }
    return value;
  };

  return [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta", "os", "cpu", "libc"].some(
    (scope) =>
      JSON.stringify(canonicalizeManifestValue(locked[scope] ?? {})) !==
      JSON.stringify(canonicalizeManifestValue(current[scope] ?? {})),
  );
}
