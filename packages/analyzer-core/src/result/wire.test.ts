import { expect, test } from "vite-plus/test";
import fixtures from "./wire-fixtures.json";
import { canonicalJson } from "./json.ts";
import { analyzerResultSchema as publicSchema } from "../index.ts";
import { analyzerResultSchema as validationSchema } from "./validate.ts";
import { analyzerResultSchema as schemaDefinition } from "./result-schema.ts";
import {
  analyzerResultSchema,
  createEmptyResult,
  mergeResults,
  normalizeResult,
  parseResult,
} from "./index.ts";

test.each(fixtures)("wire conformance: $name", ({ valid, result }) => {
  if (valid) {
    expect(parseResult(result)).toEqual(result);
    expect(parseResult(JSON.parse(canonicalJson(normalizeResult(parseResult(result)))))).toEqual(
      normalizeResult(parseResult(result)),
    );
  } else {
    expect(() => parseResult(result)).toThrow();
  }
});

test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects nonportable numeric metadata before normalization can lose it: %s",
  (number) => {
    const result = { ...createEmptyResult("example:wire"), extension: { number } };
    expect(() => parseResult(result)).toThrow();
    expect(() => normalizeResult(result)).toThrow();
    expect(() => canonicalJson(result)).toThrow();
  },
);

test("deterministic JSON specifies integer-key enumeration, escaping and native array order", () => {
  const value = JSON.parse(
    '{"z":-0,"a":[2,1],"10":10,"2":2,"quote":"\\\"\\n","__proto__":{"b":2,"a":1}}',
  );
  expect(canonicalJson(value)).toBe(
    '{"2":2,"10":10,"__proto__":{"a":1,"b":2},"a":[2,1],"quote":"\\\"\\n","z":0}',
  );
});

test.each(["__proto__", "constructor", "sha256"])(
  "artifact hash %s requires a nonempty string at catalog and view level",
  (key) => {
    for (const value of [null, false, 1, "", [], { invalid: "hash" }]) {
      const artifact = { evidence: [], hashes: { [key]: value } };
      const base = {
        ...createEmptyResult("example:wire"),
        packages: [{ purl: "pkg:npm/foo", evidence: [] }],
      };
      const results = [
        { ...base, packages: [{ ...base.packages[0]!, artifacts: [artifact] }] },
        {
          ...base,
          graphs: [
            {
              id: "graph",
              source: { extractor: "wire", files: [] },
              interpretation: "unknown",
              rootCompleteness: "unknown",
              roots: [],
              nodes: [
                {
                  id: "foo",
                  purl: "pkg:npm/foo",
                  dependencyCompleteness: "unknown",
                  artifacts: [artifact],
                },
              ],
              edges: [],
            },
          ],
        },
      ];
      for (const result of results) expect(() => parseResult(result)).toThrow();
    }
  },
);

test("valid special hash keys survive schema parsing, normalization and merge", () => {
  const hashes = JSON.parse('{"__proto__":"abc","constructor":"def","sha256":"123"}');
  const result = {
    ...createEmptyResult("example:wire"),
    packages: [{ purl: "pkg:npm/foo", evidence: [], artifacts: [{ evidence: [], hashes }] }],
  };
  expect(analyzerResultSchema.parse(result).packages[0]!.artifacts![0]!.hashes).toEqual(hashes);
  expect(parseResult(result)).toEqual(result);
  expect(normalizeResult(result)).toEqual(result);
  expect(mergeResults([result, result])).toEqual(result);
});

test("schema re-exports share the same public validator instance", () => {
  expect(publicSchema).toBe(analyzerResultSchema);
  expect(validationSchema).toBe(analyzerResultSchema);
  expect(schemaDefinition).toBe(analyzerResultSchema);
});

test("repeated native JSON objects are accepted while active-path cycles are rejected", () => {
  const shared = JSON.parse('{"__proto__":{"native":true},"values":[1,null,"three"]}');
  const input = {
    ...createEmptyResult("example:shared-json"),
    extension: { first: shared, second: shared },
  };

  expect(parseResult(input)).toEqual(input);
  expect(analyzerResultSchema.parse(input)).toEqual(input);

  shared.cycle = shared;
  expect(() => parseResult(input)).toThrow("Analyzer results must contain plain JSON data only");
});

test("portable JSON and schema errors precede cross-record reference errors", () => {
  const pkg = { purl: "pkg:npm/a@1", evidence: [] };
  const duplicateCatalog = {
    ...createEmptyResult("example:validation-order"),
    packages: [pkg, pkg],
  };
  const invalidShape = { ...duplicateCatalog, codebase: "" };

  expect(() => parseResult({ ...invalidShape, extension: undefined })).toThrow(
    "Analyzer results must contain plain JSON data only",
  );
  expect(() => parseResult(invalidShape)).toThrow("Too small");
  expect(() => parseResult(duplicateCatalog)).toThrow("Duplicate package PURL: pkg:npm/a@1");
});
