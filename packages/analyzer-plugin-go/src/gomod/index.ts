import {
  createDependencyGraph,
  createEmptyResult,
  filesExtractor,
  normalizeResult,
  runCommand,
  scanAndMarkFiles,
  type AnalyzerResult,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
} from "@scatool/analyzer-core";
import { dirname } from "node:path";
import { createGoPurl } from "../go-utils.ts";

type Module = {
  Path: string;
  Version?: string;
  Main?: boolean;
  Replace?: { Path: string; Version?: string; [key: string]: unknown };
  [key: string]: unknown;
};
type Manifest = {
  Module: { Path: string };
  Require?: { Path: string; Version: string; Indirect?: boolean }[] | null;
};

// go list also reports host/cache state (Dir, GoMod, sums and lazily loaded
// metadata). Keep the native selection facts independent of cache hydration.
function selectionFacts(module: Module): JsonObject {
  return {
    Path: module.Path,
    ...(module.Version !== undefined && { Version: module.Version }),
    ...(typeof module.Indirect === "boolean" && { Indirect: module.Indirect }),
    ...(module.Replace && {
      Replace: {
        Path: module.Replace.Path,
        ...(module.Replace.Version !== undefined && { Version: module.Replace.Version }),
      },
    }),
  };
}

export function portableGoDiagnostic(stderr: string, codebasePath: string): string {
  const root = codebasePath.replace(/[\\/]$/, "");
  return stderr.replaceAll(`${root}/`, "").replaceAll(`${root}\\`, "");
}

/** Decode the concatenated JSON objects emitted by go list without depending on indentation. */
export function parseGoModules(output: string): Module[] {
  const modules: Module[] = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < output.length; index++) {
    const char = output[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      if (depth === 0) throw new Error("Malformed go list JSON stream");
      quoted = true;
    } else if (char === "{") {
      if (depth++ === 0) start = index;
    } else if (char === "}") {
      if (--depth < 0) throw new Error("Malformed go list JSON stream");
      if (depth === 0) modules.push(JSON.parse(output.slice(start, index + 1)));
    } else if (depth === 0 && char?.trim()) throw new Error("Malformed go list JSON stream");
  }
  if (depth !== 0 || quoted) throw new Error("Truncated go list JSON stream");
  if (modules.length === 0 || modules.some((module) => !module.Path))
    throw new Error("go list did not report valid module identities");
  return modules;
}

/** Native module selection is not a package import graph or proof of runtime usage. */
export function convertGoModules(
  manifest: Manifest,
  modules: Module[],
  graphOutput: string,
  file: string,
  codebase: string,
): AnalyzerResult {
  if (!manifest.Module?.Path) throw new Error("go.mod has no module identity");
  const result = createEmptyResult(codebase);
  const project = { purl: createGoPurl(manifest.Module.Path), definitionFile: file };
  result.subprojects.push(project);
  const selected = new Map(modules.map((module) => [module.Path, module]));
  const nodes: DependencyView[] = [];
  const edges: DependencyEdge[] = [];
  const purls = new Set<string>();
  for (const module of modules) {
    if (module.Path === manifest.Module.Path) continue;
    const purl = createGoPurl(module.Path, module.Version);
    if (!purls.has(purl)) result.packages.push({ purl, evidence: [file] });
    purls.add(purl);
    nodes.push({
      id: module.Path,
      purl,
      locator: `${module.Path}${module.Version ? `@${module.Version}` : ""}`,
      // go mod graph can be pruned. Missing owner records never prove a known leaf.
      dependencyCompleteness: "unknown",
      attributes: { "go:module": selectionFacts(module) },
      ...(module.Replace && {
        artifacts: [
          {
            location: module.Replace.Path,
            evidence: [file],
            attributes: { "go:replacement": selectionFacts(module).Replace! },
          },
        ],
      }),
    });
  }
  const roots = ["dependencies", "indirectDependencies", "go:build-list"].map((scope) => {
    const id = `root:${scope}`;
    nodes.push({ id, purl: project.purl, project, dependencyCompleteness: "complete" });
    return { id, project, node: id, scope };
  });
  for (const module of modules) {
    if (module.Path !== manifest.Module.Path)
      edges.push({
        from: "root:go:build-list",
        to: module.Path,
        status: "resolved",
        relation: "depends-on",
        selection: "selected",
      });
  }
  const requirement = (from: string, path: string, version: string, indirect?: boolean) => {
    const target = selected.get(path);
    const common = {
      from,
      relation: "depends-on" as const,
      selection: "selected" as const,
      requested: { name: path, specifier: version },
      ...(indirect !== undefined && { attributes: { "go:indirect": indirect } }),
    };
    if (target && path !== manifest.Module.Path)
      edges.push({ ...common, status: "resolved", to: path });
    else edges.push({ ...common, status: "unresolved" });
  };
  for (const request of manifest.Require ?? [])
    requirement(
      `root:${request.Indirect ? "indirectDependencies" : "dependencies"}`,
      request.Path,
      request.Version,
      request.Indirect ?? false,
    );
  for (const line of graphOutput.split(/\r?\n/).filter((line) => line.trim())) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2) throw new Error("Malformed go mod graph record");
    const [owner, target] = fields as [string, string];
    const split = (value: string) => {
      const index = value.lastIndexOf("@");
      return index < 0 ? [value, ""] : [value.slice(0, index), value.slice(index + 1)];
    };
    const [ownerPath, ownerVersion] = split(owner) as [string, string];
    const [path, version] = split(target) as [string, string];
    if (path === "go" || path === "toolchain" || ownerPath === "go" || ownerPath === "toolchain")
      continue;
    if (ownerPath === manifest.Module.Path) continue; // Exact direct/indirect declarations above.
    const ownerModule = selected.get(ownerPath);
    if (!ownerModule || (ownerModule.Version ?? "") !== ownerVersion) continue;
    requirement(ownerPath, path, version);
  }
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "gomod", files: [file] },
      interpretation: "resolved",
      rootCompleteness: "complete",
      roots,
      nodes,
      edges,
      attributes: {
        "go:moduleGraph": graphOutput,
        "go:membership": "module-build-list",
        "go:manifest": manifest as unknown as JsonObject,
      },
    }),
  );
  return normalizeResult(result);
}

export const extractor = filesExtractor({
  name: "gomod",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, "**/go.mod", ["**/vendor/**", "**/.cache/**"]);
  },
  extractFile: async (file, _options, context) => {
    const command = async (args: string[]) => {
      const output = await runCommand(["go", ...args], { cwd: dirname(file) });
      if (output.exitCode !== 0)
        throw new Error(
          `go ${args.join(" ")} failed: ${portableGoDiagnostic(output.stderr, context.codebasePath)}`,
        );
      return output.stdout;
    };
    const manifest = JSON.parse(await command(["mod", "edit", "-json"]));
    const modules = parseGoModules(await command(["list", "-m", "-json", "all"]));
    const graph = await command(["mod", "graph"]);
    return convertGoModules(manifest, modules, graph, context.relativeFile, context.codebaseId);
  },
});
