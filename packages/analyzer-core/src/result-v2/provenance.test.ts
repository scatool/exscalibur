import { expect, test } from "vite-plus/test";
import { createEmptyResultV2, mergeResultsV2, normalizeResultV2, parseResultV2 } from "./index.ts";
import type { IdentityObservation } from "./types.ts";

const purl = "pkg:generic/example@1";
const assertion = (file: string, synthesizedPurl: boolean): IdentityObservation => ({
  source: { extractor: "fixture", files: [file], key: "component" },
  synthesizedPurl,
});
function observation(identityObservations?: IdentityObservation[]) {
  return {
    ...createEmptyResultV2("example:repo"),
    packages: [
      { purl, evidence: ["input"], ...(identityObservations && { identityObservations }) },
    ],
    subprojects: [
      { purl, definitionFile: "manifest", ...(identityObservations && { identityObservations }) },
    ],
  };
}

test("catalog-only identity assertions preserve source association across conflicting observations", () => {
  const native = observation([assertion("native.json", false)]);
  const fallback = observation([assertion("fallback.json", true)]);
  const unknown = observation();
  const merged = mergeResultsV2([native, fallback, unknown]);
  const expected = [assertion("fallback.json", true), assertion("native.json", false)];
  expect(merged.packages[0]!.identityObservations).toEqual(expected);
  expect(merged.subprojects[0]!.identityObservations).toEqual(expected);
  expect(merged.graphs).toEqual([]);
  expect(mergeResultsV2([unknown, fallback, native])).toEqual(merged);
  expect(mergeResultsV2([merged, merged])).toEqual(merged);
  expect(parseResultV2(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
});

test("absence is not a native identity assertion and source entity keys remain distinct", () => {
  const fallback = observation([assertion("input", true)]);
  const merged = mergeResultsV2([fallback, observation()]);
  expect(merged.packages[0]!.identityObservations).toEqual([assertion("input", true)]);
  const other = assertion("input", false);
  other.source.key = "other-component";
  expect(
    mergeResultsV2([fallback, observation([other])]).packages[0]!.identityObservations,
  ).toHaveLength(2);
});

test("identity source files are set-valued and repeated assertions deduplicate", () => {
  const value = assertion("input", true);
  value.source.files = ["z", "a", "a"];
  const result = normalizeResultV2(observation([value, { ...value }]));
  expect(result.packages[0]!.identityObservations).toEqual([
    {
      source: { extractor: "fixture", files: ["a", "z"], key: "component" },
      synthesizedPurl: true,
    },
  ]);
});

test("unscoped synthesized flags are rejected on catalogs rather than accepted as extensions", () => {
  for (const field of ["packages", "subprojects"] as const) {
    const input = observation();
    Object.assign(input[field][0]!, { synthesizedPurl: true });
    expect(() => parseResultV2(input)).toThrow();
  }
});

test("disagreeing assertions from the same named source remain explicit without choosing a winner", () => {
  const first = observation([assertion("input", true)]);
  const second = observation([assertion("input", false)]);
  const merged = mergeResultsV2([first, second]);
  expect(merged.packages[0]!.identityObservations).toEqual([
    assertion("input", false),
    assertion("input", true),
  ]);
  expect(mergeResultsV2([second, first])).toEqual(merged);
});
