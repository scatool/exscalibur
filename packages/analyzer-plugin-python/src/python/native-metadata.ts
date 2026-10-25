import type { DependencyRequest, JsonValue } from "@scatool/analyzer-core";

type RecordValue = Record<string, unknown>;

// Missing collections are valid empty metadata; present malformed values must fail.
export const readMetadataTable = (value: unknown): RecordValue => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Python metadata table");
  return value as RecordValue;
};

export const readMetadataList = (value: unknown): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Expected a Python metadata list");
  return value;
};

export const toNativeJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

export const normalizePackageName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** Read PEP 508 lexical boundaries, without solving version or marker expressions.
 * The grammar permits WS around extras. After @, URL consumes every non-space/tab
 * character (including semicolons); only a following WS can introduce its marker.
 * Keep this separate from Poetry/Pipfile's named native version values.
 */
export function parseRequirementParts(spec: string): {
  name?: string;
  features?: string[];
  marker?: string;
  directUrl?: boolean;
} {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*\b/;
  let remaining = spec.replace(/^[ \t]+/, "");
  const name = remaining.match(identifier)?.[0];
  if (!name) return {};

  remaining = remaining.slice(name.length).replace(/^[ \t]+/, "");
  let features: string[] | undefined;
  if (remaining.startsWith("[")) {
    const end = remaining.indexOf("]");
    if (end === -1) return { name };

    const extras = remaining.slice(1, end).trim();
    features = extras ? extras.split(",").map((extra) => extra.trim()) : [];
    if (features.some((extra) => extra.match(identifier)?.[0] !== extra)) return { name };
    remaining = remaining.slice(end + 1).replace(/^[ \t]+/, "");
  }

  const header = { name, ...(features?.length && { features }) };
  if (remaining.startsWith("@")) {
    remaining = remaining.slice(1).replace(/^[ \t]+/, "");
    const url = remaining.match(/^[^ \t]+/)?.[0];
    if (!url) return header;

    const marker = remaining
      .slice(url.length)
      .match(/^[ \t]+;[ \t]*(.*)$/s)?.[1]
      .trim();
    return { ...header, directUrl: true, ...(marker && { marker }) };
  }

  // Bare URLs and requirements-file extensions are not named PEP 508 versions.
  if (remaining && !/^(?:[<>=!~(;])/.test(remaining)) return header;
  const semicolon = remaining.indexOf(";");
  const marker = semicolon === -1 ? undefined : remaining.slice(semicolon + 1).trim();

  return { ...header, ...(marker && { marker }) };
}

export function createDependencyRequest(
  spec: string,
  name?: string,
  details?: unknown,
): DependencyRequest {
  const parsed = name === undefined ? parseRequirementParts(spec) : {};
  const parsedName = name ?? parsed.name;

  return {
    ...(parsedName && { name: parsedName }),
    specifier: spec,
    ...(parsed.features && { features: parsed.features }),
    ...(parsed.marker && { condition: { language: "pep508", expression: parsed.marker } }),
    ...(details !== undefined && { attributes: { "python:declaration": toNativeJson(details) } }),
  };
}
