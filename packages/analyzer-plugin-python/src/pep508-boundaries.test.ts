import { expect, test } from "vite-plus/test";
import { lockResult, pyprojectResult, requirementsResult } from "./python-v2.ts";

const context = {
  codebaseId: "python-boundaries",
  codebasePath: "/example",
  relativeFile: "input",
};
// These token boundaries were independently checked with Python packaging 25.0 Requirement.
// Markers remain source text, rather than packaging's normalized marker serialization.
const cases = [
  ["foo @ https://example.test/foo.whl;param", [], undefined],
  ["foo @ https://example.test/foo.whl?x=1;y=2#fragment;tail", [], undefined],
  [
    'foo @ https://example.test/foo.whl;param ; python_version < "3.12"',
    [],
    'python_version < "3.12"',
  ],
  ["foo@https://example.test/foo.whl;param", [], undefined],
  [
    'foo\t[ speed , tls ]\t@\thttps://example.test/foo.whl;param\t; os_name == "posix"',
    ["speed", "tls"],
    'os_name == "posix"',
  ],
  ['foo [speed]>=1; python_version < "3.12"', ["speed"], 'python_version < "3.12"'],
  ["foo [ ]", [], undefined],
  [
    'foo [speed, tls] (>=1, !=2) ; os_name == "posix;other"',
    ["speed", "tls"],
    'os_name == "posix;other"',
  ],
  ["foo [speed]", ["speed"], undefined],
  ['foo; python_version >= "3.10"', [], 'python_version >= "3.10"'],
] as const;

for (const adapter of ["requirements", "pyproject", "pdm"] as const)
  for (const [specifier, features, marker] of cases)
    test(`${adapter}: PEP 508 token boundaries in ${specifier}`, () => {
      const result =
        adapter === "requirements"
          ? requirementsResult(specifier, context)
          : adapter === "pyproject"
            ? pyprojectResult(
                `[project]\nname="app"\ndependencies=[${JSON.stringify(specifier)}]\n`,
                context,
              )
            : lockResult(
                `[[package]]\nname="app"\nversion="1"\ndependencies=[${JSON.stringify(specifier)}]\n[[package]]\nname="foo"\nversion="2"\n`,
                context,
                "pdmlock",
              );
      const edge = result.graphs[0]!.edges.find((item) => item.requested?.specifier === specifier)!;
      expect(edge.requested?.name).toBe("foo");
      expect(edge.requested?.features ?? []).toEqual(features);
      expect(edge.requested?.condition?.expression).toBe(marker);
      if (adapter !== "pdm") {
        expect(edge.condition?.expression).toBe(marker);
        expect(edge.selection).toBe(marker ? "conditional" : "selected");
      } else if (specifier.includes("https://")) {
        expect(edge.status).toBe("unresolved");
      }
    });

test("Poetry version strings remain native grammar while explicit extras and markers are retained", () => {
  const result = pyprojectResult(
    '[tool.poetry]\nname="app"\n[tool.poetry.dependencies]\nfoo="^1.2"\nbar={version="~2", extras=["speed"], markers="os_name == \'posix\'"}\n',
    context,
  );
  const edges = result.graphs[0]!.edges;
  expect(edges.find((edge) => edge.requested?.name === "foo")?.requested).toMatchObject({
    name: "foo",
    specifier: "^1.2",
  });
  expect(edges.find((edge) => edge.requested?.name === "bar")?.requested).toMatchObject({
    name: "bar",
    specifier: "~2",
    features: ["speed"],
  });
  expect(edges.find((edge) => edge.requested?.name === "bar")?.condition?.language).toBe(
    "poetry:dependency",
  );
});
