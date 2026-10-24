import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  normalizeResultV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyRoot,
  type DependencyView,
  type JsonObject,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { parse as parseYaml } from "yaml";

export const extractorV2 = filesExtractorV2({
  name: "github-actions",
  version: 1,
  markFiles: async function (codebase) {
    await scanAndMarkFiles(this, codebase, ".github/workflows/**/*.{yml,yaml}", []);
  },
  extractFile: async (file, _options, context) =>
    extractWorkflowV2(await readNormalizedTextFile(file), context.relativeFile, context.codebaseId),
});

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Workflow step references are declarations; execution and action internals remain unobserved. */
export function extractWorkflowV2(
  content: string,
  filePath = ".github/workflows/workflow.yml",
  codebase = "input:github-actions",
): AnalyzerResultV2 {
  const workflow: unknown = parseYaml(content);
  if (!record(workflow) || !record(workflow.jobs)) throw new Error("Expected workflow jobs object");
  const result = createEmptyResultV2(codebase);
  const project = {
    purl: new PackageURL("generic", "github-actions", "workflow", null, null, null).toString(),
    definitionFile: filePath,
  };
  result.subprojects.push({
    ...project,
    evidence: [filePath],
    identityObservations: [
      { source: { extractor: "github-actions", files: [filePath] }, synthesizedPurl: true },
    ],
  });
  const nodes: DependencyView[] = [];
  const roots: DependencyRoot[] = [];
  const edges: DependencyEdge[] = [];
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const node = `job:${jobId}`;
    roots.push({ id: node, project, scope: jobId, node });
    let incomplete = !record(job) || !Array.isArray(job.steps);
    if (record(job) && Array.isArray(job.steps)) {
      for (const [index, step] of job.steps.entries()) {
        if (!record(step)) {
          incomplete = true;
          continue;
        }
        if (!Object.hasOwn(step, "uses")) continue;
        if (typeof step.uses !== "string" || !step.uses) {
          incomplete = true;
          continue;
        }
        const predicates: JsonObject = {};
        if (typeof job.if === "string" || typeof job.if === "boolean") predicates.job = job.if;
        if (typeof step.if === "string" || typeof step.if === "boolean") predicates.step = step.if;
        const unsupportedPredicate =
          (job.if !== undefined && !Object.hasOwn(predicates, "job")) ||
          (step.if !== undefined && !Object.hasOwn(predicates, "step"));
        if (unsupportedPredicate) incomplete = true;
        edges.push({
          from: node,
          relation: "depends-on",
          status: "declared",
          kind: "uses",
          ...(unsupportedPredicate
            ? { selection: "unknown" as const }
            : Object.keys(predicates).length
              ? {
                  selection: "conditional" as const,
                  condition: { language: "github-actions", expression: predicates },
                }
              : { selection: "selected" as const }),
          requested: { id: `${node}/step:${index}`, name: step.uses, specifier: step.uses },
          evidence: [filePath],
          attributes: { "github-actions:job": jobId, "github-actions:step": index },
        });
      }
    }
    if (incomplete)
      result.issues.push({
        code: "INCOMPLETE_WORKFLOW_JOB",
        severity: "WARNING",
        message: `Step dependencies were not fully observed for job '${jobId}'`,
        file: filePath,
      });
    nodes.push({
      id: node,
      purl: project.purl,
      project,
      dependencyCompleteness: incomplete ? "partial" : "complete",
    });
  }
  result.graphs.push(
    createDependencyGraph({
      source: { extractor: "github-actions", files: [filePath] },
      interpretation: "declared",
      rootCompleteness: "complete",
      roots,
      nodes,
      edges,
    }),
  );
  return normalizeResultV2(result);
}
