import {
  addRelationship,
  type AnalyzerResult,
  buildResult,
  type DependencyScope,
  ensurePackageExists,
  errorResult,
  initializeExtractionMaps,
  type Issue,
  type MarkFileContext,
  readNormalizedTextFile,
  runCommand,
  scanAndMarkFiles,
  type Subproject,
} from "@scatool/analyzer-core";
import { createConanPurl, createLocalNodeConanPurl } from "./utils.ts";
import type { ConanOptions } from "./options.ts";
import type { ConanFileGraph, Dependency, Node, NodeId } from "./types.ts";
import { resolve } from "path";

export async function markFiles(this: MarkFileContext, codebase: string, options: ConanOptions) {
  for (const pattern of options.conanFiles) {
    await scanAndMarkFiles(this, codebase, pattern, options.ignore);
  }
}

export async function extractFile(file: string, options: ConanOptions): Promise<AnalyzerResult> {
  // retrieve absolute path to ensure consistent behavior
  // note: using non-posix resolve is important here, because else on
  // Windows the following will happen: resolve('C:\\path') === '/Users/cwd/C:/path'
  file = resolve(file).replaceAll("\\", "/");

  const conan_path = options.conanPath;

  // Retrieve json graph data
  // Will automatically detect and use lockfiles if present
  const cmd = [conan_path, "graph", "info", file, "--format", "json"];
  if (options.profileBuild) {
    cmd.push("--profile:build", options.profileBuild);
  }
  if (options.profileHost) {
    cmd.push("--profile:host", options.profileHost);
  }
  if (options.conanArgs) {
    cmd.push(...options.conanArgs);
  }

  const { stdout, stderr, exitCode } = await runCommand(cmd);

  if (exitCode !== 0) {
    return errorResult(
      file,
      file,
      `"${cmd.join(" ")}" failed with exit code ${exitCode}: ${stderr}`,
      "conanfile.command_failed",
    );
  }

  // detect warnings in stderr and include them as issues in the result
  const issues: Issue[] = [];
  if (stderr.includes("WARN")) {
    issues.push({
      code: "conanfile.command_warning",
      message: `Warnings from running "${cmd.join(" ")}": ${stderr}`,
      severity: "WARNING",
      file,
    });
  }

  let graphData: ConanFileGraph;
  try {
    graphData = JSON.parse(stdout);
  } catch (error) {
    return errorResult(
      file,
      file,
      `Failed to parse JSON output from "${cmd.join(" ")}": ` +
        (error instanceof Error ? error.message : String(error)),
      "conanfile.command_output_parse_failed",
    );
  }

  if (!graphData || !graphData.graph) {
    return errorResult(
      file,
      file,
      `Invalid graph data from "${cmd.join(" ")}": missing "graph" property`,
      "conanfile.invalid_graph_data",
    );
  }

  if (graphData.graph.error !== undefined && graphData.graph.error !== null) {
    return errorResult(
      file,
      file,
      `Error in graph data from "${cmd.join(" ")}": ` + JSON.stringify(graphData.graph.error),
      "conanfile.graph_error",
    );
  }

  const conanfileContent = await readNormalizedTextFile(file);
  const result = convertConanFileGraph(graphData, file, conanfileContent);
  result.issues.push(...issues);
  return result;
}

function convertConanFileGraph(
  graphData: ConanFileGraph,
  file: string,
  conanfileContent: string,
): AnalyzerResult {
  const { packageMap, relationshipsMap } = initializeExtractionMaps();
  const subprojects: Subproject[] = [];
  const issues: Issue[] = [];

  const graph = graphData.graph;
  if (!graph || !graph.nodes) {
    return buildResult(packageMap, relationshipsMap, subprojects);
  }

  // Build a map of node IDs to Nodes for quick lookup
  const nodesById: Record<NodeId, Node> = graph.nodes;
  const nodeEntries = Object.entries(graph.nodes) as [NodeId, Node][];

  // Identify root nodes (packages being consumed/built)
  const rootNodeIds = new Set<NodeId>();
  if (graph.root) {
    for (const nodeId of Object.keys(graph.root)) {
      rootNodeIds.add(nodeId);
    }
  }

  // Process all nodes to extract packages
  for (const [nodeId, node] of nodeEntries) {
    try {
      // Determine if this is a local/editable package (should be a subproject)
      const isLocal = isLocalPackage(node);
      const isRoot = rootNodeIds.has(nodeId);

      if (isLocal || isRoot) {
        // Create subproject for local packages or root packages
        const purl = createLocalNodeConanPurl(node, file);
        const scopes = extractDependencyScopes(node, nodesById, file);

        subprojects.push({
          purl,
          definitionFile: file,
          scopes,
        });
      } else if (node.name && node.version) {
        // For non-local, non-root nodes, handle packages and relationships
        const purl = createConanPurl(node.name, node.version, node.rrev);
        ensurePackageExists(packageMap, purl);

        const lineNumbers = findConanReferenceLineNumber(conanfileContent, node.name, node.version);
        for (const lineNumber of lineNumbers) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Process dependencies to create relationships
        if (node.dependencies) {
          for (const [depNodeId] of Object.entries(node.dependencies) as [NodeId, Dependency][]) {
            const depNode = nodesById[depNodeId];
            if (!depNode) continue;

            if (!depNode.name || !depNode.version) {
              issues.push({
                code: "conanfile.dependency_node_incomplete",
                message: `Dependency node ${depNodeId} is missing name or version, skipping relationship from ${purl}.`,
                severity: "WARNING",
                file,
              });
              continue;
            }

            const depPurl = createConanPurl(depNode.name, depNode.version, depNode.rrev);
            ensurePackageExists(packageMap, depPurl);

            // Add relationship from this package to its dependency
            addRelationship(relationshipsMap, purl, depPurl);
          }
        }
      } else {
        issues.push({
          code: "conanfile.node_unresolvable",
          message: `Node ${nodeId} is neither a local, root nor a resolvable package.`,
          severity: "WARNING",
          file,
        });
      }
    } catch (error) {
      issues.push({
        code: "conanfile.node_processing_failed",
        message: `Error processing node ${nodeId}: ${error instanceof Error ? error.message : String(error)}`,
        severity: "ERROR",
        file,
      });
    }
  }

  return buildResult(packageMap, relationshipsMap, subprojects, issues);
}

/**
 * Determine if a node represents a local/editable package
 */
function isLocalPackage(node: Node): boolean {
  return (
    node.name === null ||
    node.recipe === "Editable" ||
    node.recipe === "Consumer" ||
    node.recipe === "Cli" ||
    node.recipe === "Platform"
  );
}

/**
 * Extract dependency scopes from a node's dependencies
 */
function extractDependencyScopes(
  node: Node,
  nodesById: Record<NodeId, Node>,
  file: string,
): DependencyScope[] {
  const scopes: DependencyScope[] = [];

  if (!node.dependencies) {
    return scopes;
  }

  // Group dependencies by their type
  const deps = {
    runtime: [] as string[],
    build: [] as string[],
    test: [] as string[],
  };

  for (const [depNodeId, dependency] of Object.entries(node.dependencies)) {
    if (!dependency.direct) {
      // only include direct dependencies in scopes
      // transitive dependencies will be included as packages and relationships but not in scopes
      continue;
    }

    const depNode = nodesById[depNodeId];
    if (!depNode) {
      continue;
    }

    const depPurl =
      isLocalPackage(depNode) || !depNode.name
        ? createLocalNodeConanPurl(depNode, file)
        : createConanPurl(depNode.name, depNode.version || "0.0.0", depNode.rrev);

    // Categorize by dependency type
    if (dependency.test) {
      deps.test.push(depPurl);
    } else if (dependency.build) {
      deps.build.push(depPurl);
    } else if (dependency.libs || dependency.run) {
      // libs=true means it's a runtime dependency
      deps.runtime.push(depPurl);
    } else {
      // Default to runtime if no specific type is set
      deps.runtime.push(depPurl);
    }
  }

  // Create scopes
  for (const entry of Object.entries(deps)) {
    const [scopeName, depPurls] = entry;
    if (depPurls.length > 0) {
      scopes.push({
        scope: scopeName,
        packages: depPurls,
      });
    }
  }
  return scopes;
}

function findConanReferenceLineNumber(content: string, name: string, version: string): number[] {
  const target = `${name}/${version}`;
  const lines = content.split("\n");
  const filteredLines = lines
    .map((line, index) => {
      // remove whitespace and comments
      if (line.includes("#")) {
        const parts = line.split("#");
        if (parts[0]) {
          line = parts[0].trim();
        } else {
          line = "";
        }
      }
      line = line.trim();

      return { line, index };
    })
    .filter(({ line }) => line.includes(target));

  // Lines are 1-indexed in evidence
  return filteredLines.map(({ index }) => index + 1);
}
