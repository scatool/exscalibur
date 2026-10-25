import { PackageURL } from "packageurl-js";
import { z } from "zod";
import { isPortableJson } from "./json.ts";
import type { JsonValue } from "./types.ts";

const text = z.string().min(1);
const json = z.custom<JsonValue>((value) => isPortableJson(value), "Expected plain JSON data");
const attributes = z.custom<Record<string, JsonValue>>(
  (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value) && isPortableJson(value),
  "Expected a JSON object",
);

// Record schemas can omit __proto__; inspect the original entries so every hash is validated.
const hashes = z.custom<Record<string, string>>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isPortableJson(value) &&
    Object.entries(value).every(
      ([key, hash]) => key.length > 0 && typeof hash === "string" && hash.length > 0,
    ),
  "Expected a JSON object with nonempty string hash names and values",
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
const extensibleObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catchall(json);

const identityObservationSchema = extensibleObject({
  source: extensibleObject({ extractor: text, files: strings, key: text.optional() }),
  synthesizedPurl: z.boolean(),
});

const conditionSchema = extensibleObject({
  language: text,
  expression: json,
  environment: text.optional(),
});

const projectReferenceSchema = extensibleObject({ purl, definitionFile: text });

const artifactSchema = extensibleObject({
  purl: purl.optional(),
  location: text.optional(),
  hashes: hashes.optional(),
  evidence: strings,
  attributes: attributes.optional(),
});

const requestSchema = extensibleObject({
  id: text.optional(),
  name: text.optional(),
  // Some native requests use an empty specifier, such as npm's unconstrained range.
  specifier: z.string().optional(),
  purl: purl.optional(),
  features: strings.optional(),
  condition: conditionSchema.optional(),
  attributes: attributes.optional(),
}).refine(
  (value) =>
    value.name !== undefined ||
    (value.specifier !== undefined && value.specifier.length > 0) ||
    value.purl !== undefined ||
    Object.keys(value.attributes ?? {}).length > 0,
  "A dependency request must identify what was requested",
);

const edgeSchema = extensibleObject({
  from: text,
  to: text.optional(),
  status: z.enum(["resolved", "declared", "unresolved"]),
  relation: z.enum(["depends-on", "constrains"]),
  kind: text.optional(),
  optional: z.boolean().optional(),
  requested: requestSchema.optional(),
  selection: z.enum(["selected", "conditional", "excluded", "unknown"]),
  condition: conditionSchema.optional(),
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

const catalogPackageSchema = extensibleObject({
  purl,
  evidence: strings,
  synthesizedPurl: z.never().optional(),
  downloadLocation: z.never().optional(),
  identityObservations: z.array(identityObservationSchema).optional(),
  artifacts: z.array(artifactSchema).optional(),
  externalReferences: z
    .array(extensibleObject({ type: z.enum(["vcs", "sourceArtifact"]), locator: text }))
    .optional(),
  attributes: attributes.optional(),
});

const subprojectSchema = extensibleObject({
  ...projectReferenceSchema.shape,
  scopes: z.never().optional(),
  evidence: strings.optional(),
  synthesizedPurl: z.never().optional(),
  identityObservations: z.array(identityObservationSchema).optional(),
  attributes: attributes.optional(),
});

const dependencyRootSchema = extensibleObject({
  id: text,
  project: projectReferenceSchema,
  scope: text,
  node: text,
  context: attributes.optional(),
  evidence: strings.optional(),
});

const dependencyViewSchema = extensibleObject({
  id: text,
  purl,
  project: projectReferenceSchema.optional(),
  locator: z.string().optional(),
  dependencyCompleteness: completeness,
  variant: extensibleObject({
    name: text.optional(),
    attributes: attributes.optional(),
    enabledFeatures: strings.optional(),
  }).optional(),
  artifacts: z.array(artifactSchema).optional(),
  evidence: strings.optional(),
  attributes: attributes.optional(),
});

const dependencyGraphSchema = extensibleObject({
  id: text,
  source: extensibleObject({
    extractor: text,
    files: strings,
    key: text.optional(),
    tool: extensibleObject({ name: text, version: text.optional() }).optional(),
  }),
  interpretation: z.enum(["declared", "locked", "resolved", "installed", "unknown"]),
  context: attributes.optional(),
  rootCompleteness: completeness,
  roots: z.array(dependencyRootSchema),
  nodes: z.array(dependencyViewSchema),
  edges: z.array(edgeSchema),
  attributes: attributes.optional(),
});

const issueSchema = extensibleObject({
  code: text,
  message: text,
  severity: z.enum(["HINT", "WARNING", "ERROR"]),
  file: text.optional(),
});

/** Field shapes and binding constraints; parseResultV2 also checks the full JSON value and references. */
export const analyzerResultV2Schema = extensibleObject({
  formatVersion: z.literal(2),
  relationships: z.never().optional(),
  codebase: text,
  packages: z.array(catalogPackageSchema),
  subprojects: z.array(subprojectSchema),
  graphs: z.array(dependencyGraphSchema),
  issues: z.array(issueSchema),
});
