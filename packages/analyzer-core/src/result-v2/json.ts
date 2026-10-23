import type { JsonValue } from "./types.ts";

/** Object key order is insignificant. Native array order is preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function normalizeJson<T extends JsonValue>(value: T): T {
  return canonicalValue(value) as T;
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

export function uniqueRecords<T>(values: readonly T[]): T[] {
  const records = new Map(values.map((value) => [canonicalJson(value), value]));
  return [...records.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([, value]) => value);
}
