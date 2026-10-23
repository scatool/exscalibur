import { PackageURL } from "packageurl-js";
import { z } from "zod";
import type { AnalyzerResultV2, JsonValue, ProjectReference } from "./types.ts";

const text = z.string().min(1);
const json = z.custom<JsonValue>((value) => isJson(value), "Expected plain JSON data");
const attributes = z.custom<Record<string, JsonValue>>(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value) && isJson(value),
  "Expected a JSON object",
);
const strings = z.array(text);
const completeness = z.enum(["complete", "partial", "unknown"]);
const purl = text.refine((value) => {
  try {
    return PackageURL.fromString(value).toString() === value;
  } catch {
    return false;
  }
}, "Expected a valid canonical Package URL");

// Preserve additive JSON fields instead of silently stripping fields from newer producers.
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catchall(json);
const condition = object({ language: text, expression: json, environment: text.optional() });
const projectReference = object({ purl, definitionFile: text });
const artifact = object({
  purl: purl.optional(),
  location: text.optional(),
  hashes: z.record(text, text).optional(),
  evidence: strings,
  attributes: attributes.optional(),
});
const request = object({
  id: text.optional(),
  name: text.optional(),
  specifier: text.optional(),
  purl: purl.optional(),
  features: strings.optional(),
  condition: condition.optional(),
  attributes: attributes.optional(),
}).refine(
  (value) =>
    value.name !== undefined ||
    value.specifier !== undefined ||
    value.purl !== undefined ||
    Object.keys(value.attributes ?? {}).length > 0,
  "A dependency request must identify what was requested",
);
const edge = object({
  from: text,
  to: text.optional(),
  status: z.enum(["resolved", "declared", "unresolved"]),
  relation: z.enum(["depends-on", "constrains"]),
  kind: text.optional(),
  optional: z.boolean().optional(),
  requested: request.optional(),
  selection: z.enum(["selected", "conditional", "excluded", "unknown"]),
  condition: condition.optional(),
  evidence: strings.optional(),
  attributes: attributes.optional(),
}).superRefine((value, context) => {
  if (value.status === "resolved" && value.to === undefined) {
    context.addIssue({
      code: "custom",
      message: "A resolved dependency requires a target view",
      path: ["to"],
    });
  }
  if (value.status !== "resolved") {
    if (value.to !== undefined) {
      context.addIssue({
        code: "custom",
        message: "An unresolved declaration cannot have a resolved target",
        path: ["to"],
      });
    }
    if (value.requested === undefined) {
      context.addIssue({
        code: "custom",
        message: "An unresolved declaration requires its original request",
        path: ["requested"],
      });
    }
  }
  if (value.selection === "conditional" && value.condition === undefined) {
    context.addIssue({
      code: "custom",
      message: "Conditional selection requires a binding condition",
      path: ["condition"],
    });
  }
  if (
    (value.selection === "selected" || value.selection === "excluded") &&
    value.condition !== undefined
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Recorded selection cannot also have a binding condition; preserve original predicates in requested.condition",
      path: ["condition"],
    });
  }
});

export const analyzerResultV2Schema = object({
  formatVersion: z.literal(2),
  codebase: text,
  packages: z.array(
    object({
      purl,
      evidence: strings,
      synthesizedPurl: z.boolean().optional(),
      artifacts: z.array(artifact).optional(),
      externalReferences: z
        .array(object({ type: z.enum(["vcs", "sourceArtifact"]), locator: text }))
        .optional(),
      attributes: attributes.optional(),
    }),
  ),
  subprojects: z.array(
    object({
      ...projectReference.shape,
      evidence: strings.optional(),
      synthesizedPurl: z.boolean().optional(),
      attributes: attributes.optional(),
    }),
  ),
  graphs: z.array(
    object({
      id: text,
      source: object({
        extractor: text,
        files: strings,
        key: text.optional(),
        tool: object({ name: text, version: text.optional() }).optional(),
      }),
      interpretation: z.enum(["declared", "locked", "resolved", "installed", "unknown"]),
      context: attributes.optional(),
      rootCompleteness: completeness,
      roots: z.array(
        object({
          id: text,
          project: projectReference,
          scope: text,
          node: text,
          context: attributes.optional(),
          evidence: strings.optional(),
        }),
      ),
      nodes: z.array(
        object({
          id: text,
          purl,
          project: projectReference.optional(),
          locator: z.string().optional(),
          dependencyCompleteness: completeness,
          variant: object({
            name: text.optional(),
            attributes: attributes.optional(),
            enabledFeatures: strings.optional(),
          }).optional(),
          artifacts: z.array(artifact).optional(),
          evidence: strings.optional(),
          attributes: attributes.optional(),
        }),
      ),
      edges: z.array(edge),
      attributes: attributes.optional(),
    }),
  ),
  issues: z.array(
    object({
      code: text,
      message: text,
      severity: z.enum(["HINT", "WARNING", "ERROR"]),
      file: text.optional(),
    }),
  ),
});

export function projectKey(project: ProjectReference): string {
  return JSON.stringify([project.purl, project.definitionFile]);
}

/** Validate serialized input, retain additive fields, and check all graph-local references. */
export function parseResultV2(value: unknown): AnalyzerResultV2 {
  if (!isJson(value)) throw new Error("Analyzer results must contain plain JSON data only");
  analyzerResultV2Schema.parse(value);
  // Some schema libraries omit __proto__ for safe object construction. It is a valid JSON data
  // key, so validate first and clone the original data rather than using a transformed schema result.
  const result = structuredClone(value) as AnalyzerResultV2;
  validateReferences(result);
  return result;
}

function isJson(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from(value).every((item) => isJson(item, ancestors))
    : Object.values(value).every((item) => isJson(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export function validateResultV2(result: AnalyzerResultV2): void {
  parseResultV2(result);
}

function unique<T>(items: readonly T[], key: (item: T) => string, subject: string): Map<string, T> {
  const mapping = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (mapping.has(id)) throw new Error(`Duplicate ${subject}: ${id}`);
    mapping.set(id, item);
  }
  return mapping;
}

function validateReferences(result: AnalyzerResultV2): void {
  const packages = unique(result.packages, (item) => item.purl, "package PURL");
  const projects = unique(result.subprojects, projectKey, "project/subject");
  unique(result.graphs, (graph) => graph.id, "graph ID");
  for (const graph of result.graphs) {
    const nodes = unique(graph.nodes, (node) => node.id, `view ID in graph '${graph.id}'`);
    unique(graph.roots, (root) => root.id, `root ID in graph '${graph.id}'`);
    for (const node of graph.nodes) {
      if (node.project) {
        if (node.project.purl !== node.purl || !projects.has(projectKey(node.project))) {
          throw new Error(
            `View '${node.id}' in graph '${graph.id}' references an unknown or inconsistent project/subject`,
          );
        }
      } else if (!packages.has(node.purl)) {
        throw new Error(
          `View '${node.id}' in graph '${graph.id}' references an unknown package: ${node.purl}`,
        );
      }
    }
    for (const root of graph.roots) {
      const node = nodes.get(root.node);
      if (
        !projects.has(projectKey(root.project)) ||
        !node?.project ||
        projectKey(root.project) !== projectKey(node.project)
      ) {
        throw new Error(
          `Root '${root.id}' in graph '${graph.id}' must reference its exact project/subject's view`,
        );
      }
    }
    for (const dependency of graph.edges) {
      if (!nodes.has(dependency.from)) {
        throw new Error(
          `Dependency in graph '${graph.id}' has an unknown source view: ${dependency.from}`,
        );
      }
      if (dependency.status === "resolved" && !nodes.has(dependency.to)) {
        throw new Error(
          `Dependency in graph '${graph.id}' has an unknown target view: ${dependency.to}`,
        );
      }
    }
  }
}
