import { expect, test } from "vite-plus/test";
import fixtures from "./wire-fixtures.json";
import { canonicalJson } from "./json.ts";
import { createEmptyResultV2, normalizeResultV2, parseResultV2 } from "./index.ts";

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
