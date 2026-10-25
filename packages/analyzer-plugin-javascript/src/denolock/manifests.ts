import { realpath } from "node:fs/promises";
import { isAbsolute, relative as filesystemRelative, resolve, sep } from "node:path";
import { dirname, join } from "node:path/posix";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { readNormalizedTextFile, type FileExtractionContextV2 } from "@scatool/analyzer-core";
import { assertPortableManifest, table, type NpmRecord } from "../npm-v2.ts";
import { DenoObservation } from "./observation.ts";
import { record } from "./locked-packages.ts";

/** Keep manifest caching and lexical/realpath containment checks at one filesystem boundary. */
export async function createManifestReader(
  file: string,
  context: FileExtractionContextV2,
  native: DenoObservation,
) {
  const codebaseDirectory = await realpath(context.codebasePath);

  const isWithinDirectory = (root: string, path: string): boolean => {
    const within = filesystemRelative(root, path);
    return !isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`);
  };

  const canReadManifest = async (location: string, name: string): Promise<boolean> => {
    const path = join(dirname(file), location, name);
    let safe =
      location !== ".." &&
      !location.startsWith("../") &&
      !location.startsWith("/") &&
      isWithinDirectory(resolve(context.codebasePath), resolve(path));

    // Lexical containment does not detect symlinks. Check the existing file's resolved target too.
    if (safe) {
      try {
        safe = isWithinDirectory(codebaseDirectory, await realpath(path));
      } catch (error) {
        if (
          !(
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          native.issue(
            "deno.manifest_unreadable",
            `Could not verify the local manifest '${join(location, name)}'; only recorded lock metadata is used`,
          );

        return false;
      }
    }

    if (!safe)
      native.issue(
        "deno.manifest_outside_codebase",
        `Local manifest '${join(location, name)}' leaves its lockfile directory or the scanned codebase; only recorded lock metadata is used`,
      );

    return safe;
  };

  const loadedConfigs = new Map<string, { manifest: NpmRecord; file?: string }>();
  const loadConfig = async (location: string) => {
    if (loadedConfigs.has(location)) return loadedConfigs.get(location)!;

    let loaded: { manifest: NpmRecord; file?: string } = { manifest: {} };
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (!(await canReadManifest(location, name))) continue;

      const path = join(dirname(file), location, name);
      try {
        const errors: ParseError[] = [];
        const manifest = record(
          parseJsonc(await readNormalizedTextFile(path), errors, { allowTrailingComma: true }),
        );
        if (errors.length > 0) throw new Error("Invalid Deno configuration JSONC");
        assertPortableManifest(manifest);

        // Validate the projected identity before allowing current metadata into an observation.
        const definition = join(dirname(context.relativeFile), location, name);
        const candidate = new DenoObservation(context, "declared", "current-config-declarations");
        candidate.project(location, "deno", manifest, definition);
        candidate.finish();

        loaded = { manifest, file: definition };
        break;
      } catch (error) {
        if (
          !(
            error !== null &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          native.issue(
            "deno.manifest_unreadable",
            `Could not read '${path}': ${error instanceof Error ? error.message : String(error)}`,
          );
      }
    }

    loadedConfigs.set(location, loaded);
    return loaded;
  };

  return { canReadManifest, loadConfig };
}

export function addConfigDeclarations(
  observation: DenoObservation,
  location: string,
  manifest: NpmRecord,
  definition: string,
): void {
  const project = observation.project(location, "deno", manifest, definition);
  const scopes = [
    { scope: "imports", imports: table(manifest, "imports") },
    ...Object.entries(table(manifest, "scopes")).map(([scope, imports]) => ({
      scope: `imports:${scope}`,
      imports: record(imports),
      condition: {
        language: "deno:import-scope/v1",
        expression: { referrerPrefix: scope },
      },
    })),
  ];

  for (const scope of scopes) {
    const root = observation.root(project, scope.scope);
    if (manifest.importMap !== undefined)
      observation.nodes.get(root)!.dependencyCompleteness = "unknown";

    for (const [alias, specifier] of Object.entries(scope.imports)) {
      if (typeof specifier !== "string")
        throw new Error(`Invalid Deno import mapping for '${alias}'`);

      observation.edge(root, { name: alias, specifier }, undefined, "imports", {
        declaration: true,
        ...("condition" in scope && { condition: scope.condition }),
      });
    }
  }
}
