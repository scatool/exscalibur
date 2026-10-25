import { createHash } from "node:crypto";
import { PackageURL } from "packageurl-js";
import {
  createDependencyGraph,
  createEmptyResultV2,
  normalizeResultV2,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyRequest,
  type DependencyView,
  type FileExtractionContextV2,
  type JsonObject,
} from "@scatool/analyzer-core";
import { createPypiPurl } from "../python-utils.ts";
import { normalizePackageName } from "./native-metadata.ts";

/** Accumulate one file's observation without merging declarations into locked facts. */
export class PythonObservation {
  readonly result: AnalyzerResultV2;
  readonly nodes: DependencyView[] = [];
  readonly edges: DependencyEdge[] = [];
  readonly roots: {
    id: string;
    project: { purl: string; definitionFile: string };
    scope: string;
    node: string;
  }[] = [];

  constructor(
    readonly context: FileExtractionContextV2,
    readonly extractor: string,
    readonly interpretation: "declared" | "locked",
  ) {
    this.result = createEmptyResultV2(context.codebaseId);
  }

  addProject(name?: string, version?: string) {
    const purl = name
      ? createPypiPurl(normalizePackageName(name), version)
      : new PackageURL(
          "generic",
          "python-input",
          createHash("sha256")
            .update(JSON.stringify([this.context.codebaseId, this.context.relativeFile]))
            .digest("hex"),
          null,
          null,
          null,
        ).toString();

    const project = { purl, definitionFile: this.context.relativeFile };
    this.result.subprojects.push({
      ...project,
      evidence: [this.context.relativeFile],
      identityObservations: [
        {
          source: { extractor: this.extractor, files: [this.context.relativeFile] },
          synthesizedPurl: !name,
        },
      ],
    });

    return project;
  }

  addRoot(project: { purl: string; definitionFile: string }, scope: string) {
    const id = `scope:${JSON.stringify(scope)}`;
    if (!this.nodes.some((node) => node.id === id)) {
      this.nodes.push({ id, purl: project.purl, project, dependencyCompleteness: "complete" });
      this.roots.push({ id, project, scope, node: id });
    }

    return id;
  }

  addDeclaration(
    from: string,
    requested: DependencyRequest,
    condition = requested.condition,
    kind = "dependency",
    optional?: boolean,
  ) {
    this.edges.push({
      from,
      status: "declared",
      relation: "depends-on",
      requested,
      kind,
      ...(optional !== undefined && { optional }),
      ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      evidence: [this.context.relativeFile],
    });
  }

  addIssue(code: string, message: string) {
    this.result.issues.push({
      code: `${this.extractor}.${code}`,
      message,
      severity: "WARNING",
      file: this.context.relativeFile,
    });
  }

  finish(rootCompleteness: "complete" | "unknown" = "complete", attributes?: JsonObject) {
    this.result.graphs.push(
      createDependencyGraph({
        source: { extractor: this.extractor, files: [this.context.relativeFile] },
        interpretation: this.interpretation,
        rootCompleteness,
        roots: this.roots,
        nodes: this.nodes,
        edges: this.edges,
        ...(attributes && { attributes }),
      }),
    );

    return normalizeResultV2(this.result);
  }
}
