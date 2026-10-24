import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  findExecutable,
  readTextFile,
  runCommand,
  scanAndMarkFiles,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { optionSchema, type MavenOptions } from "./options.ts";

export type MavenTreeNode = {
  groupId: string;
  artifactId: string;
  version: string;
  type?: string;
  classifier?: string;
  scope?: string;
  optional?: string | boolean;
  children?: MavenTreeNode[];
};

function purl(node: MavenTreeNode): string {
  if (!node.groupId || !node.artifactId || !node.version)
    throw new Error("Maven tree has missing coordinates");
  const qualifiers: Record<string, string> = {};
  if (node.type && node.type !== "jar") qualifiers.type = node.type;
  if (node.classifier) qualifiers.classifier = node.classifier;
  return new PackageURL(
    "maven",
    node.groupId,
    node.artifactId,
    node.version,
    qualifiers,
    null,
  ).toString();
}

/** Keep each selected tree occurrence: exclusions and mediation can change equal-coordinate views. */
export function convertMavenTreeV2(
  tree: MavenTreeNode,
  file: string,
  codebase: string,
): AnalyzerResultV2 {
  const result = createEmptyResultV2(codebase);
  const project = { purl: purl(tree), definitionFile: file };
  result.subprojects.push(project);
  const nodes: DependencyView[] = [];
  const edges: DependencyEdge[] = [];
  const catalog = new Set<string>();
  const addNode = (node: MavenTreeNode, id: string) => {
    const identity = purl(node);
    if (!catalog.has(identity)) result.packages.push({ purl: identity, evidence: [file] });
    catalog.add(identity);
    const { children: _, ...native } = node;
    nodes.push({
      id,
      purl: identity,
      locator: id,
      // The native tree prunes duplicate/conflict branches. Even a record without
      // children can have dependencies, so its outgoing coverage is not established.
      dependencyCompleteness: "unknown",
      attributes: { "maven:node": native as JsonObject },
    });
    for (const [index, child] of (node.children ?? []).entries()) {
      const target = `${id}/${index}`;
      edges.push(binding(id, target, child));
      addNode(child, target);
    }
  };
  const binding = (from: string, to: string, node: MavenTreeNode): DependencyEdge => ({
    from,
    to,
    status: "resolved",
    relation: "depends-on",
    selection: "selected",
    ...(node.scope && { kind: node.scope }),
    ...(node.optional !== undefined && {
      optional: node.optional === true || node.optional === "true",
    }),
  });
  const scopes = [
    "maven:dependency-tree",
    ...new Set((tree.children ?? []).map((node) => node.scope || "compile")),
  ];
  const roots = scopes.map((scope) => {
    const id = `root:${scope}`;
    nodes.push({ id, purl: project.purl, project, dependencyCompleteness: "complete" });
    return { id, project, node: id, scope };
  });
  for (const [index, child] of (tree.children ?? []).entries()) {
    const target = `tree/${index}`;
    addNode(child, target);
    edges.push(binding("root:maven:dependency-tree", target, child));
    edges.push(binding(`root:${child.scope || "compile"}`, target, child));
  }
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "maven", files: [file] },
      interpretation: "resolved",
      rootCompleteness: "complete",
      roots,
      nodes,
      edges,
      attributes: { "maven:projection": "dependency-tree", "maven:requests": "not-reported" },
    }),
  );
  return normalizeResultV2(result);
}

export const extractor = filesExtractorV2<MavenOptions>({
  name: "maven",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/pom.xml", options.ignore);
  },
  extractFile: async (file, options, context) => {
    const dir = dirname(file);
    const wrapper = join(dir, process.platform === "win32" ? "mvnw.cmd" : "mvnw");
    const executable = existsSync(wrapper)
      ? wrapper
      : findExecutable(options.mavenPath) || options.mavenPath;
    const temporary = await mkdtemp(join(tmpdir(), "exscalibur-maven-"));
    try {
      const output = join(temporary, "tree.json");
      const command = await runCommand(
        [
          executable,
          "dependency:tree",
          "-DoutputType=json",
          `-DoutputFile=${output}`,
          "--batch-mode",
          "--non-recursive",
        ],
        {
          cwd: dir,
          env: { ...process.env, ...(options.javaHome && { JAVA_HOME: options.javaHome }) },
        },
      );
      if (command.exitCode !== 0) {
        const diagnostics = [command.stderr.trim(), command.stdout.trim()]
          .filter(Boolean)
          .join("\n");
        throw new Error(
          `Maven dependency extraction failed (exit ${command.exitCode})${diagnostics ? `: ${diagnostics}` : ""}`,
        );
      }
      return convertMavenTreeV2(
        JSON.parse(await readTextFile(output)),
        context.relativeFile,
        context.codebaseId,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
});
