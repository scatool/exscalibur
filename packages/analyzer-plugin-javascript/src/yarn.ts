import { dirname, join, normalize, relative } from "node:path/posix";
import {
  mergeResults,
  readNormalizedTextFile,
  scanFiles,
  type AnalyzerResult,
  type FileExtractionContext,
} from "@scatool/analyzer-core";
import { NpmGraph, json } from "./npm-graph.ts";
import { addCurrentManifestObservation, loadNpmManifest, table } from "./npm-manifest.ts";
import type { JavaScriptOptions } from "./options.ts";
import { parseYarnLock, type YarnLockEntry } from "./yarn-lock.ts";
import {
  YarnObservationProjection,
  yarnDeclarations,
  type WorkspaceManifest,
} from "./yarn-observation.ts";

/** Keep native locked topology and current-manifest scope correlation as separate observations. */
export async function extractYarn(
  file: string,
  options: JavaScriptOptions,
  context: FileExtractionContext,
  modern: boolean,
): Promise<AnalyzerResult> {
  const content = await readNormalizedTextFile(file);
  const { entries, metadata } = parseYarnLock(content, modern);
  const name = modern ? "yarnberry" : "yarnlock";

  const nativeLock = new NpmGraph(context, name);
  nativeLock.attributes["yarn:observation"] = "native-lock";
  nativeLock.attributes["yarn:metadata"] = json(metadata);
  nativeLock.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";
  nativeLock.result.issues.push({
    code: "yarn.raw_lock_projection",
    severity: "HINT",
    file: context.relativeFile,
    message:
      "Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed",
  });

  // Manifest discovery is separate from lock parsing and may fail without losing native evidence.
  const manifests = new Map<string, WorkspaceManifest>();
  const loadWorkspaceManifest = async (location: string, entry?: YarnLockEntry) => {
    const loaded = await loadNpmManifest(
      join(dirname(file), location, "package.json"),
      entry ? { name: entry.name } : {},
      nativeLock,
    );
    const definition = loaded.available
      ? join(dirname(context.relativeFile), location, "package.json")
      : `${context.relativeFile}#workspace=${encodeURIComponent(location)}`;
    const manifest = {
      location,
      definition,
      ...loaded,
      declarationsKnown: loaded.available,
      ...(entry && { entry }),
    };
    manifests.set(location, manifest);
    if (loaded.available) nativeLock.sourceFiles.add(definition);

    return manifest;
  };

  if (modern) {
    for (const entry of entries)
      if (entry.workspace !== undefined) await loadWorkspaceManifest(entry.workspace, entry);
  }

  if (!manifests.has(".")) await loadWorkspaceManifest(".");

  let workspaceDiscoveryFailed = false;
  if (!modern) {
    try {
      const root = manifests.get(".")!.manifest;
      const workspaces = Array.isArray(root.workspaces)
        ? root.workspaces
        : table(root, "workspaces").packages;
      if (workspaces !== undefined && !Array.isArray(workspaces))
        throw new Error("Expected Yarn workspace patterns");

      for (const pattern of workspaces ?? []) {
        if (typeof pattern !== "string")
          throw new Error("Expected a string Yarn workspace pattern");

        for (const manifest of await scanFiles(
          dirname(file),
          `${pattern}/package.json`,
          options.ignore,
        )) {
          const location = normalize(relative(dirname(file), dirname(manifest)));
          if (!manifests.has(location)) await loadWorkspaceManifest(location);
        }
      }
    } catch (error) {
      workspaceDiscoveryFailed = true;
      nativeLock.result.issues.push({
        code: "yarn.workspace_declarations_failed",
        severity: "WARNING",
        file: manifests.get(".")!.definition,
        message: `Could not discover current workspaces; native lock evidence is retained: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const currentDeclarations = new NpmGraph(context, "packagejson", "declared");
  currentDeclarations.sourceFiles.clear();
  if (workspaceDiscoveryFailed) currentDeclarations.rootCompleteness = "partial";

  for (const manifest of manifests.values())
    if (manifest.available)
      manifest.declarationsKnown = addCurrentManifestObservation(
        currentDeclarations,
        manifest.location,
        manifest.definition,
        manifest.manifest,
        () => yarnDeclarations(manifest.manifest),
      );

  const currentManifestScopes = new NpmGraph(context, name);
  currentManifestScopes.attributes["yarn:observation"] = "current-manifest-scopes";
  currentManifestScopes.attributes["yarn:scopeSource"] = "current-manifests";
  currentManifestScopes.attributes["yarn:peerBindings"] = "not-recorded-in-lockfile";

  for (const builder of [nativeLock, currentManifestScopes]) {
    builder.attributes["yarn:projection"] = "raw-descriptor-map";
    builder.attributes["yarn:effectiveResolution"] = "not-observed";
    builder.attributes["yarn:resolverTransformations"] = "not-applied";
  }

  if (!modern || !entries.some((entry) => entry.workspace !== undefined))
    nativeLock.rootCompleteness = "unknown";
  if (
    workspaceDiscoveryFailed ||
    [...manifests.values()].some((manifest) => !manifest.declarationsKnown)
  )
    currentManifestScopes.rootCompleteness = "partial";

  const projectionInput = { entries, metadata, manifests, modern };
  new YarnObservationProjection(nativeLock, {
    ...projectionInput,
    correlateCurrentManifests: false,
  }).populate();
  new YarnObservationProjection(currentManifestScopes, {
    ...projectionInput,
    correlateCurrentManifests: true,
  }).populate();

  return mergeResults([
    nativeLock.finish(),
    currentManifestScopes.finish(),
    ...(currentDeclarations.result.subprojects.length > 0 ? [currentDeclarations.finish()] : []),
  ]);
}
