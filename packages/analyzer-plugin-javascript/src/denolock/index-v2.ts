import { dirname, join, normalize, relative } from "node:path/posix";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  scanFiles,
} from "@scatool/analyzer-core";
import {
  NpmGraphV2,
  addManifestObservation,
  json,
  loadNpmManifest,
  table,
  type NpmRecord,
} from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import { DenoObservation } from "./observation.ts";
import { observeLockedPackages, record, strings } from "./locked-packages.ts";
import { addConfigDeclarations, createManifestReader } from "./manifests.ts";

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "denolock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/deno.lock", options.ignore);
  },
  extractFile: async (file, options, context) => {
    const document = record(JSON.parse(await readNormalizedTextFile(file)));
    if (
      !["3", "4", "5"].includes(
        typeof document.version === "number"
          ? String(document.version)
          : (document.version as string),
      )
    )
      throw new Error(`Unsupported Deno lockfile version: ${JSON.stringify(document.version)}`);

    const version = Number(document.version);
    const tables = version === 3 ? table(document, "packages") : document;

    const nativeLock = new DenoObservation(context, "locked", "native-lock");
    const configDeclarations = new DenoObservation(
      context,
      "declared",
      "current-config-declarations",
    );
    const packageDeclarations = new NpmGraphV2(context, "packagejson", "declared");
    packageDeclarations.sourceFiles.clear();

    const { specifiers, resolveRegistryRequirement } = observeLockedPackages(nativeLock, {
      document,
      tables,
      version,
    });

    // Current manifests add declaration observations; they do not replace the native lock graph.
    const workspace = table(document, "workspace");
    const members = new Map<string, NpmRecord>([
      [".", workspace],
      ...Object.entries(table(workspace, "members")).map(
        ([location, value]) => [normalize(location), record(value)] as const,
      ),
    ]);

    const { canReadManifest, loadConfig } = await createManifestReader(file, context, nativeLock);

    const rootConfig = await loadConfig(".");
    try {
      for (const pattern of strings(rootConfig.manifest.workspace)) {
        const location = normalize(pattern);
        if (location === ".." || location.startsWith("../") || location.startsWith("/"))
          throw new Error(`Deno workspace pattern is outside its lockfile directory: ${pattern}`);

        for (const path of await scanFiles(
          dirname(file),
          `${pattern}/{deno.json,deno.jsonc,package.json}`,
          options.ignore,
        )) {
          const location = normalize(relative(dirname(file), dirname(path)));
          if (!members.has(location)) members.set(location, {});
        }
      }
    } catch (error) {
      configDeclarations.rootCompleteness = "partial";
      configDeclarations.result.issues.push({
        code: "deno.workspace_declarations_failed",
        severity: "WARNING",
        file: rootConfig.file ?? context.relativeFile,
        message: `Could not discover current workspace declarations: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const nativeLocations = new Set([
      ".",
      ...Object.keys(table(workspace, "members")).map((key) => normalize(key)),
    ]);

    for (const [location, member] of members) {
      const config = await loadConfig(location);
      const jsonManifest = (await canReadManifest(location, "package.json"))
        ? await loadNpmManifest(
            join(dirname(file), location, "package.json"),
            {},
            packageDeclarations,
          )
        : { manifest: {}, available: false };
      if (jsonManifest.available) {
        const definition = join(dirname(context.relativeFile), location, "package.json");
        try {
          addManifestObservation(packageDeclarations, location, definition, jsonManifest.manifest);
        } catch (error) {
          const project = packageDeclarations.addProject(
            location,
            definition,
            jsonManifest.manifest,
            false,
          );
          packageDeclarations.addRoot(project, "dependencies");
          packageDeclarations.sourceFiles.add(definition);
          packageDeclarations.rootCompleteness = "unknown";
          packageDeclarations.result.issues.push({
            code: "deno.manifest_declarations_failed",
            severity: "WARNING",
            file: definition,
            message: `Could not read current package declarations: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      // Newly discovered current workspaces cannot invent roots in the native lock observation.
      const nativeMember = document.workspace !== undefined && nativeLocations.has(location);
      if (
        nativeMember &&
        (config.file ||
          member.dependencies !== undefined ||
          (!jsonManifest.available && member.packageJson === undefined))
      ) {
        const definition =
          config.file ?? `${context.relativeFile}#workspace/${encodeURIComponent(location)}/deno`;
        const project = nativeLock.project(location, "deno", config.manifest, definition);
        const root = nativeLock.root(project, "deno:dependencies");

        for (const dependency of strings(member.dependencies)) {
          const resolved = resolveRegistryRequirement(dependency);
          nativeLock.edge(root, resolved.request, resolved.target, "deno:dependencies");
        }
      }

      if (nativeMember && (jsonManifest.available || member.packageJson !== undefined)) {
        const definition = jsonManifest.available
          ? join(dirname(context.relativeFile), location, "package.json")
          : `${context.relativeFile}#workspace/${encodeURIComponent(location)}/packageJson`;
        const project = nativeLock.project(location, "npm", jsonManifest.manifest, definition);
        const root = nativeLock.root(project, "packageJson:dependencies");

        for (const dependency of strings(table(member, "packageJson").dependencies)) {
          const resolved = resolveRegistryRequirement(dependency);
          nativeLock.edge(root, resolved.request, resolved.target, "packageJson:dependencies");
        }
      }

      if (config.file) {
        try {
          // Preflight the complete declaration observation before mutating the shared builder.
          const candidate = new DenoObservation(context, "declared", "current-config-declarations");
          addConfigDeclarations(candidate, location, config.manifest, config.file);
          candidate.finish();

          addConfigDeclarations(configDeclarations, location, config.manifest, config.file);
        } catch (error) {
          const project = configDeclarations.project(
            location,
            "deno",
            config.manifest,
            config.file,
          );
          configDeclarations.rootCompleteness = "partial";
          const root = configDeclarations.root(project, "imports");
          configDeclarations.nodes.get(root)!.dependencyCompleteness = "unknown";
          configDeclarations.result.issues.push({
            code: "deno.config_declarations_failed",
            severity: "WARNING",
            file: config.file,
            message: `Could not read current import declarations: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    const { npm: _npm, jsr: _jsr, packages: _packages, ...remaining } = document;
    nativeLock.attributes["deno:document"] = json(remaining);
    nativeLock.attributes["deno:specifiers"] = json(specifiers);
    nativeLock.attributes["deno:jsrDependencyCoverage"] = "observed-lock-retention-graph";
    nativeLock.rootCompleteness = document.workspace === undefined ? "unknown" : "complete";
    if (packageDeclarations.result.subprojects.length === 0)
      nativeLock.result.issues.push(...packageDeclarations.result.issues);

    return mergeResultsV2([
      nativeLock.finish(),
      ...(configDeclarations.result.subprojects.length > 0 ? [configDeclarations.finish()] : []),
      ...(packageDeclarations.result.subprojects.length > 0 ? [packageDeclarations.finish()] : []),
    ]);
  },
});
