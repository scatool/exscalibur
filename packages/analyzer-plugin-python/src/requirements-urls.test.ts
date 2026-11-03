import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import { requirementsResult } from "./extraction.ts";

const context = {
  codebaseId: "requirements-url-names",
  codebasePath: "/example",
  relativeFile: "requirements.txt",
};

// pip 26.2.1 independently recognizes the two pinned integration declarations.
// URL contents are not fetched: these assertions concern declaration identity only.
const namedUrls = [
  [
    "git+https://github.com/techalchemy/test-project.git@master#egg=pep508-package&subdirectory=parent_folder/pep508-package",
    "pep508-package",
  ],
  ["https://github.com/pallets/click/archive/7.0.zip#egg=click", "click"],
  ["git+ssh://git@example.test/project.git#egg=My_Project.Name-2", "My_Project.Name-2"],
  ["file:///tmp/project.zip#egg=local", "local"],
  ["https://example.test/project.zip#subdirectory=src&egg=project", "project"],
  ["https://example.test/project.zip#egg=first&egg=second", "first"],
  ["https://example.test/project.WHL#egg=project", "project"],
  ["https://example.test/project.whl;parameter#egg=project", "project"],
  ["-e git+https://example.test/project.git#egg=editable", "editable"],
] as const;

for (const [specifier, name] of namedUrls)
  test(`retains the legacy URL declaration name in ${specifier}`, () => {
    const result = requirementsResult(specifier, context);
    validateResult(result);
    const graph = result.graphs[0]!;

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      status: "declared",
      requested: { name, specifier },
    });
    expect(graph.edges[0]!.requested?.features).toBeUndefined();
    expect(result.packages).toEqual([]);
    expect(queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id })).toMatchObject({
      definite: [],
      completeness: "unknown",
    });
  });

const unnamedUrls = [
  "https://example.test/project.zip",
  "https://example.test/project.zip?egg=query-name",
  "https://example.test/project.zip?download=1&egg=query-name",
  "https://example.test/path&egg=path-name/project.zip",
  "https://example.test/project.zip#subdirectory=egg=not-a-name",
  "https://example.test/project.zip#other-egg=not-a-name",
  "https://example.test/project.zip#egg=encoded%2Dname",
  "https://example.test/project.zip#egg=malformed%ZZ",
  "https://example.test/project.zip#egg=invalid/name",
  "https://example.test/project.zip#egg=invalid-",
  "https://example.test/project.zip#egg=project[extra]",
  "https://example.test/project.zip#egg=&egg=second",
  "https://example.test/project.zip#egg=invalid/name&egg=second",
  "https://example.test/project.zip#egg=project;url-parameter",
  "https://example.test/actual-1.0-py3-none-any.whl#egg=other",
  "https://example.test/actual-1.0-py3-none-any.whl?download=1#egg=other",
  "https://example.test/actual-1.0-py3-none-any%2Ewhl#egg=other",
  "https://example.test/actual-1.0-py3-none-any.whl/#egg=other",
  "https://example.test/malformed%ZZ.zip#egg=project",
];

for (const specifier of unnamedUrls)
  test(`does not invent a declaration name from ${specifier}`, () => {
    const result = requirementsResult(specifier, context);
    validateResult(result);
    const request = result.graphs[0]!.edges[0]!.requested;

    expect(request).toEqual({ specifier });
    expect(result.packages).toEqual([]);
  });

for (const specifier of [
  'https://example.test/project.zip#egg=project ; python_version < "3.12"',
  'https://example.test/project.zip#egg=project; python_version < "3.12"',
  'https://example.test/project.zip;parameter#egg=project ; python_version < "3.12"',
])
  test(`preserves legacy URL marker boundaries in ${specifier}`, () => {
    const result = requirementsResult(specifier, context);
    validateResult(result);

    expect(result.graphs[0]!.edges[0]).toMatchObject({
      status: "declared",
      selection: "conditional",
      condition: { language: "pep508", expression: 'python_version < "3.12"' },
      requested: {
        name: "project",
        specifier,
        condition: { language: "pep508", expression: 'python_version < "3.12"' },
      },
    });
  });

test("retains a marker even when a legacy URL has no package name", () => {
  const specifier = 'https://example.test/project.zip ; os_name == "posix"';
  const result = requirementsResult(specifier, context);

  expect(result.graphs[0]!.edges[0]!.requested).toEqual({
    specifier,
    condition: { language: "pep508", expression: 'os_name == "posix"' },
  });
});

for (const prefix of ["", "-e ", "--editable="])
  test(`explicit direct-reference identity wins over egg for ${prefix || "noneditable"}`, () => {
    const specifier = `${prefix}Actual [speed, tls] @ git+https://example.test/project.git#egg=other ; os_name == "posix"`;
    const result = requirementsResult(specifier, context);
    validateResult(result);

    expect(result.graphs[0]!.edges[0]!.requested).toEqual({
      name: "Actual",
      features: ["speed", "tls"],
      specifier,
      condition: { language: "pep508", expression: 'os_name == "posix"' },
    });
  });

test("malformed auxiliary fragments do not discard independent valid declarations", () => {
  const malformed = "https://example.test/project.zip#egg=malformed%ZZ";
  const result = requirementsResult(`${malformed}\nrequests>=2\n`, context);
  validateResult(result);

  expect(result.graphs[0]!.edges.map((edge) => edge.requested)).toEqual(
    expect.arrayContaining([
      { specifier: malformed },
      { name: "requests", specifier: "requests>=2" },
    ]),
  );
});

test("an explicit PEP 508 name remains authoritative for wheel URLs", () => {
  const specifier = "declared [speed] @ https://example.test/actual-1.0-py3-none-any.whl#egg=other";
  const result = requirementsResult(specifier, context);

  expect(result.graphs[0]!.edges[0]!.requested).toEqual({
    name: "declared",
    features: ["speed"],
    specifier,
  });
});

test("egg text in a named requirement marker is not a URL fragment", () => {
  const specifier = 'declared [speed]>=1 ; os_name == "#egg=other"';
  const result = requirementsResult(specifier, context);

  expect(result.graphs[0]!.edges[0]!.requested).toEqual({
    name: "declared",
    features: ["speed"],
    specifier,
    condition: { language: "pep508", expression: 'os_name == "#egg=other"' },
  });
});
