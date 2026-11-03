import { readFile } from "node:fs/promises";
import { NpmGraph, json, type NpmRecord } from "./npm-graph.ts";
import { NPM_DEPENDENCY_SCOPES } from "./npm-utils.ts";

export type NpmDeclaration = {
  scope: string;
  name: string;
  specifier: string;
  optional?: boolean;
  excluded: boolean;
};

export function addManifestObservation(
  builder: NpmGraph,
  location: string,
  definitionFile: string,
  manifest: NpmRecord,
  declarations: NpmDeclaration[] = dependencyScopes(manifest),
): void {
  const project = builder.addProject(location, definitionFile, manifest, true);
  builder.sourceFiles.add(definitionFile);
  builder.nodes.get(project.consumer)!.dependencyCompleteness = "unknown";

  for (const scope of NPM_DEPENDENCY_SCOPES) {
    const root = builder.addRoot(project, scope);
    for (const declaration of declarations.filter((item) => item.scope === scope)) {
      builder.dependency(root, declaration.name, declaration.specifier, scope, undefined, {
        status: "declared",
        selection: declaration.excluded ? "excluded" : "selected",
        optional: declaration.optional,
      });
    }
  }
}

/** A malformed auxiliary manifest must not invalidate an independent native lock observation. */
export function addCurrentManifestObservation(
  builder: NpmGraph,
  location: string,
  definitionFile: string,
  manifest: NpmRecord,
  readDeclarations: () => NpmDeclaration[] = () => dependencyScopes(manifest),
): boolean {
  let declarations: NpmDeclaration[];

  try {
    declarations = readDeclarations();

    // Validate in an isolated builder before adding any declarations to the shared
    // observation. A late normalization error must not leave half a manifest behind.
    const candidate = new NpmGraph(builder.context, builder.extractor, builder.interpretation);
    addManifestObservation(candidate, location, definitionFile, manifest, declarations);
    candidate.finish();
  } catch (error) {
    const project = builder.addProject(location, definitionFile, manifest, false);
    builder.sourceFiles.add(definitionFile);
    builder.nodes.get(project.consumer)!.attributes!["npm:invalidDeclarations"] = json(
      Object.fromEntries(
        [...NPM_DEPENDENCY_SCOPES, "peerDependenciesMeta", "dependenciesMeta"]
          .filter((key) => Object.hasOwn(manifest, key))
          .map((key) => [key, manifest[key]]),
      ),
    );

    for (const scope of NPM_DEPENDENCY_SCOPES) {
      builder.addRoot(project, scope);
    }

    builder.rootCompleteness = "partial";
    builder.result.issues.push({
      code: "npm.manifest_declarations_failed",
      severity: "WARNING",
      file: definitionFile,
      message: `Could not read current manifest declarations; native lock evidence is retained: ${error instanceof Error ? error.message : String(error)}`,
    });

    return false;
  }

  addManifestObservation(builder, location, definitionFile, manifest, declarations);
  return true;
}

export function table(record: NpmRecord, name: string): Record<string, unknown> {
  if (!Object.hasOwn(record, name)) return {};

  const value = record[name];
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected an npm ${name} table`);
  }

  return value as NpmRecord;
}

export function dependencyScopes(record: NpmRecord): NpmDeclaration[] {
  const optional = table(record, "optionalDependencies");
  const peerMeta = table(record, "peerDependenciesMeta");

  return NPM_DEPENDENCY_SCOPES.flatMap((scope) =>
    Object.entries(table(record, scope)).flatMap(([name, value]) => {
      if (name.length === 0) throw new Error(`Expected a nonempty ${scope} dependency name`);
      if (typeof value !== "string") {
        throw new Error(`Expected a string ${scope} request for '${name}'`);
      }

      const meta = peerMeta[name];
      return [
        {
          scope,
          name,
          specifier: value,
          optional:
            scope === "optionalDependencies" ||
            (scope === "peerDependencies" &&
              meta !== null &&
              typeof meta === "object" &&
              "optional" in meta &&
              meta.optional === true),
          excluded: scope === "dependencies" && Object.hasOwn(optional, name),
        },
      ];
    }),
  );
}

export async function loadNpmManifest(
  file: string,
  fallback: NpmRecord,
  builder: NpmGraph,
): Promise<{ manifest: NpmRecord; available: boolean }> {
  try {
    const value: unknown = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected a package manifest object");
    }

    assertPortableManifest(value);
    // Validate the exact project representation before its identity/metadata can enter a lock graph.
    const candidate = new NpmGraph(builder.context, "packagejson", "declared");
    candidate.addProject(".", file, value as NpmRecord, true);
    candidate.finish();

    return { manifest: value as NpmRecord, available: true };
  } catch (error) {
    if (
      !(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
    ) {
      builder.result.issues.push({
        code: "npm.manifest_unreadable",
        severity: "WARNING",
        file,
        message: `Could not read package manifest; using lockfile metadata: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return { manifest: fallback, available: false };
  }
}

/** JSONC parsing and JSON.stringify can hide nonfinite numbers; inspect auxiliary input first. */
export function assertPortableManifest(value: unknown): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
  ) {
    throw new Error("Manifest contains a nonportable number; current manifest data is omitted");
  }

  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertPortableManifest(item);
  }
}
