import { expect, test } from "vite-plus/test";
import fixtures from "./wire-fixtures.json";
import { canonicalJson } from "./json.ts";
import { analyzerResultV2Schema as publicSchema } from "../index.ts";
import { analyzerResultV2Schema as validationSchema } from "./validate.ts";
import { analyzerResultV2Schema as schemaDefinition } from "./result-schema.ts";
import {
  analyzerResultV2Schema,
  createEmptyResultV2,
  mergeResultsV2,
  normalizeResultV2,
  parseResultV2,
} from "./index.ts";

test.each(fixtures)("wire conformance: $name", ({ valid, result }) => {
  if (valid) {
    expect(parseResultV2(result)).toEqual(result);
    expect(
      parseResultV2(JSON.parse(canonicalJson(normalizeResultV2(parseResultV2(result))))),
    ).toEqual(normalizeResultV2(parseResultV2(result)));
  } else {
    expect(() => parseResultV2(result)).toThrow();
  }
});

test.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "rejects nonportable numeric metadata before normalization can lose it: %s",
  (number) => {
    const result = { ...createEmptyResultV2("example:wire"), extension: { number } };
    expect(() => parseResultV2(result)).toThrow();
    expect(() => normalizeResultV2(result)).toThrow();
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
        ...createEmptyResultV2("example:wire"),
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
      for (const result of results) expect(() => parseResultV2(result)).toThrow();
    }
  },
);

test("valid special hash keys survive schema parsing, normalization and merge", () => {
  const hashes = JSON.parse('{"__proto__":"abc","constructor":"def","sha256":"123"}');
  const result = {
    ...createEmptyResultV2("example:wire"),
    packages: [{ purl: "pkg:npm/foo", evidence: [], artifacts: [{ evidence: [], hashes }] }],
  };
  expect(analyzerResultV2Schema.parse(result).packages[0]!.artifacts![0]!.hashes).toEqual(hashes);
  expect(parseResultV2(result)).toEqual(result);
  expect(normalizeResultV2(result)).toEqual(result);
  expect(mergeResultsV2([result, result])).toEqual(result);
});

test("schema re-exports share the same public validator instance", () => {
  expect(publicSchema).toBe(analyzerResultV2Schema);
  expect(validationSchema).toBe(analyzerResultV2Schema);
  expect(schemaDefinition).toBe(analyzerResultV2Schema);
});

test("repeated native JSON objects are accepted while active-path cycles are rejected", () => {
  const shared = JSON.parse('{"__proto__":{"native":true},"values":[1,null,"three"]}');
  const input = {
    ...createEmptyResultV2("example:shared-json"),
    extension: { first: shared, second: shared },
  };

  expect(parseResultV2(input)).toEqual(input);
  expect(analyzerResultV2Schema.parse(input)).toEqual(input);

  shared.cycle = shared;
  expect(() => parseResultV2(input)).toThrow("Analyzer results must contain plain JSON data only");
});

test("portable JSON and schema errors precede cross-record reference errors", () => {
  const pkg = { purl: "pkg:npm/a@1", evidence: [] };
  const duplicateCatalog = {
    ...createEmptyResultV2("example:validation-order"),
    packages: [pkg, pkg],
  };
  const invalidShape = { ...duplicateCatalog, codebase: "" };

  expect(() => parseResultV2({ ...invalidShape, extension: undefined })).toThrow(
    "Analyzer results must contain plain JSON data only",
  );
  expect(() => parseResultV2(invalidShape)).toThrow("Too small");
  expect(() => parseResultV2(duplicateCatalog)).toThrow("Duplicate package PURL: pkg:npm/a@1");
});
