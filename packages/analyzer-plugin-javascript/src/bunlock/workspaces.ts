import { dirname, join, normalize } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import type { FileExtractionContextV2 } from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import {
  NpmGraphV2,
  addCurrentManifestObservation,
  json,
  loadNpmManifest,
  type NpmProject,
  type NpmRecord,
} from "../npm-v2.ts";
import { readBunRecord } from "./placements.ts";

export type BunWorkspace = { project: NpmProject; locked: boolean; caller: string };

/** Register locked workspace identity independently from current manifest declarations. */
export async function registerBunWorkspaces(
  file: string,
  context: FileExtractionContextV2,
  workspaces: NpmRecord,
  builder: NpmGraphV2,
  declared: NpmGraphV2,
): Promise<Map<string, BunWorkspace>> {
  const projects = new Map<string, BunWorkspace>();

  const addProject = async (location: string, metadata: NpmRecord, locked: boolean) => {
    if (projects.has(normalize(location)))
      throw new Error(`Duplicate Bun workspace location: ${location}`);

    const loaded = await loadNpmManifest(
      join(dirname(file), location, "package.json"),
      metadata,
      builder,
    );
    const definition = loaded.available
      ? join(dirname(context.relativeFile), location, "package.json")
      : `${context.relativeFile}#workspaces/${encodeURIComponent(location)}`;

    const identity = {
      ...metadata,
      ...(metadata.version === undefined &&
        typeof loaded.manifest.version === "string" && { version: loaded.manifest.version }),
      ...Object.fromEntries(
        ["os", "cpu", "libc"]
          .filter((key) => metadata[key] === undefined && loaded.manifest[key] !== undefined)
          .map((key) => [key, loaded.manifest[key]]),
      ),
    };

    const project = builder.addProject(
      location,
      definition,
      locked ? identity : loaded.manifest,
      locked || loaded.available,
    );
    builder.nodes.get(project.consumer)!.attributes!["bun:workspace"] = json(metadata);
    projects.set(normalize(location), { project, locked, caller: "" });

    if (loaded.available) {
      builder.sourceFiles.add(definition);
      const declarationsKnown = addCurrentManifestObservation(
        declared,
        location,
        definition,
        loaded.manifest,
      );

      if (!locked && !declarationsKnown) {
        project.known = false;
        builder.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";
      }

      if (
        locked &&
        [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta"].some(
          (key) => !isDeepStrictEqual(metadata[key] ?? {}, loaded.manifest[key] ?? {}),
        )
      )
        builder.result.issues.push({
          code: "bun.manifest_lock_mismatch",
          severity: "WARNING",
          file: definition,
          message:
            "Current manifest declarations differ from the Bun workspace lock; each observation retains its own requests",
        });
    }
  };

  for (const [location, value] of Object.entries(workspaces))
    await addProject(location, readBunRecord(value), true);

  // Missing locked root identity stays uncertain even when a current manifest is readable.
  if (!projects.has(".")) {
    await addProject("", {}, false);
    builder.rootCompleteness = "unknown";
  }

  return projects;
}
