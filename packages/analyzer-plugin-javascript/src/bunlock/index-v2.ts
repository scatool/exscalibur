import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  filesExtractorV2,
  mergeResultsV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { NPM_DEPENDENCY_SCOPES } from "../npm-utils.ts";
import { NpmGraphV2, dependencyScopes, json, table, type NpmRecord } from "../npm-v2.ts";
import { optionSchema, type JavaScriptOptions } from "../options.ts";
import {
  readBunRecord,
  readBunDependencyNames,
  registerBunPackagePlacements,
} from "./placements.ts";
import { registerBunWorkspaces } from "./workspaces.ts";

export const extractorV2 = filesExtractorV2<JavaScriptOptions>({
  name: "bunlock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/bun.{lock,lockb}", options.ignore);
  },
  extractFile: async (file, _options, context) => {
    if (file.endsWith(".lockb"))
      throw new Error("Binary Bun lockfiles are unsupported; dependency coverage is unknown");

    const errors: ParseError[] = [];
    const document = readBunRecord(
      parseJsonc(await readNormalizedTextFile(file), errors, { allowTrailingComma: true }),
    );
    if (errors.length > 0)
      throw new Error(
        `Invalid Bun JSONC lockfile: ${errors.map((error) => error.error).join(", ")}`,
      );

    if (![0, 1, 2, 3].includes(document.lockfileVersion as number))
      throw new Error(
        `Unsupported Bun lockfile version: ${JSON.stringify(document.lockfileVersion)}`,
      );

    const builder = new NpmGraphV2(context, "bunlock");
    const declared = new NpmGraphV2(context, "packagejson", "declared");
    declared.sourceFiles.clear();

    const { packages: _packages, workspaces: _workspaces, ...metadata } = document;
    builder.attributes["bun:metadata"] = json(metadata);
    builder.attributes["bun:peerBindings"] = "not-established-from-placement-alone";

    // Workspace identities and source declarations precede package placement registration.
    const packages = table(document, "packages");
    const workspaces = table(document, "workspaces");
    const projects = await registerBunWorkspaces(file, context, workspaces, builder, declared);

    const { entries, workspaceAliases, targets, resolveDependency } = registerBunPackagePlacements(
      packages,
      document.lockfileVersion,
      projects,
      builder,
    );

    const addDependencies = (
      from: string,
      metadata: NpmRecord,
      options: {
        caller: string;
        isDependencyConsumer: boolean;
        hasLockedDeclarations: boolean;
        onlyScope?: string;
        isWorkspace?: boolean;
      },
    ) => {
      const {
        caller,
        isDependencyConsumer,
        hasLockedDeclarations,
        onlyScope,
        isWorkspace = false,
      } = options;

      const optionalPeers = new Set(readBunDependencyNames(metadata.optionalPeers));
      const unresolved = new Set(readBunDependencyNames(metadata.unresolved));

      for (const declaration of dependencyScopes(metadata)) {
        if (onlyScope !== undefined && declaration.scope !== onlyScope) continue;

        const peer = declaration.scope === "peerDependencies";
        const optional = declaration.optional || (peer && optionalPeers.has(declaration.name));
        const excluded =
          declaration.excluded || (isDependencyConsumer && declaration.scope === "devDependencies");

        const explicitlyUnresolved = unresolved.has(declaration.name);
        const strippedCatalog = !isWorkspace && declaration.specifier.startsWith("catalog:");
        const candidate =
          explicitlyUnresolved || strippedCatalog
            ? undefined
            : resolveDependency(caller, declaration.name, declaration.specifier);

        let selection: "selected" | "excluded" | "unknown" = "selected";
        if (excluded || (explicitlyUnresolved && optional)) {
          selection = "excluded";
        } else if (peer || !hasLockedDeclarations || (optional && candidate === undefined)) {
          selection = "unknown";
        }

        builder.dependency(
          from,
          declaration.name,
          declaration.specifier,
          declaration.scope,
          candidate,
          {
            selection,
            optional,
            ...((peer ||
              excluded ||
              explicitlyUnresolved ||
              strippedCatalog ||
              (optional && candidate === undefined)) && { status: "declared" as const }),
            attributes: {
              "bun:caller": caller,
              ...(peer && {
                "bun:peerBinding": candidate ? "placement-candidate" : "not-reported",
              }),
              ...(explicitlyUnresolved && { "bun:explicitlyUnresolved": true }),
              ...(strippedCatalog && { "bun:catalogReferenceStripped": true }),
            },
          },
        );
      }
    };

    // Each project exposes all native scopes; consumer views exclude development edges.
    for (const { project, locked, caller } of projects.values()) {
      if (!locked && !project.known) {
        for (const scope of NPM_DEPENDENCY_SCOPES) builder.addRoot(project, scope);
        continue;
      }

      addDependencies(project.consumer, project.manifest, {
        caller,
        isDependencyConsumer: true,
        hasLockedDeclarations: locked,
        isWorkspace: true,
      });
      for (const scope of NPM_DEPENDENCY_SCOPES)
        addDependencies(builder.addRoot(project, scope), project.manifest, {
          caller,
          isDependencyConsumer: false,
          hasLockedDeclarations: locked,
          onlyScope: scope,
          isWorkspace: true,
        });
    }

    // Workspace aliases use their own placement context, including v0 tuple declarations.
    for (const entry of entries) {
      const alias = workspaceAliases.get(entry);
      if (alias) {
        const tupleWorkspace =
          document.lockfileVersion === 0 && entry.reference.startsWith("workspace:");
        if (!entry.infoComplete || (!tupleWorkspace && !alias.project.known))
          builder.nodes.get(alias.view)!.dependencyCompleteness = "unknown";
        else
          addDependencies(alias.view, tupleWorkspace ? entry.metadata : alias.project.manifest, {
            caller: entry.key,
            isDependencyConsumer: true,
            hasLockedDeclarations: true,
            isWorkspace: true,
          });
        continue;
      }
      addDependencies(targets.get(entry.key)!, entry.metadata, {
        caller: entry.key,
        isDependencyConsumer: true,
        hasLockedDeclarations: true,
      });
    }

    return mergeResultsV2([
      builder.finish(),
      ...(declared.result.subprojects.length > 0 ? [declared.finish()] : []),
    ]);
  },
});
