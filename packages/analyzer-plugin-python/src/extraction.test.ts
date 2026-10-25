import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult } from "@scatool/analyzer-core";
import {
  lockResult,
  pipfileResult,
  pyprojectResult,
  requirementsResult,
  requirementsTxtExtractor,
  pyprojectTomlExtractor,
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
} from "./extraction.ts";
const context = { codebaseId: "example:python", codebasePath: "/example", relativeFile: "input" };

test("requirements retain original version requests, markers, extras and unknown included inputs", () => {
  const result = requirementsResult(
    'requests[security]>=2; python_version < "3.12"\n-r other.txt\n-e git+https://example.com/project#egg=local\n',
    context,
  );
  validateResult(result);
  expect(result.packages).toEqual([]);
  const graph = result.graphs[0]!;
  expect(graph.edges.find((edge) => edge.requested?.name === "requests")).toMatchObject({
    status: "declared",
    selection: "conditional",
    requested: { features: ["security"], condition: { language: "pep508" } },
  });
  expect(graph.edges.some((edge) => edge.requested?.specifier === "-r other.txt")).toBe(true);
  expect(
    queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
  ).toBe("unknown");
});

test("ANSI input is an extraction error rather than an empty successful declaration", () => {
  expect(() => requirementsResult("\u001b[31mrequests", context)).toThrow("ANSI");
});

test("dynamic pyproject declarations and group includes preserve unknown resolution", () => {
  const result = pyprojectResult(
    '[project]\nname="app"\ndynamic=["dependencies", "optional-dependencies"]\n[dependency-groups]\ntest=[{include-group="lint"}, "pytest>=8"]\n',
    context,
  );
  validateResult(result);
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  expect(result.graphs[0]!.edges).toHaveLength(2);
  expect(result.graphs[0]!.nodes[0]!.dependencyCompleteness).toBe("unknown");
});

test("dynamic runtime dependencies retain their own unknown root beside known optional groups", () => {
  const result = pyprojectResult(
    '[project]\nname="app"\ndynamic=["dependencies"]\n[project.optional-dependencies]\ntest=["pytest"]\nempty=[]\n',
    context,
  );
  validateResult(result);
  const graph = result.graphs[0]!;
  expect(graph.rootCompleteness).toBe("complete");
  const runtime = graph.roots.find((root) => root.scope === "dependencies");
  expect(runtime).toBeDefined();
  expect(queryDependencies(result, { graph: graph.id, root: runtime!.id })).toMatchObject({
    definite: [],
    declarations: [],
    completeness: "unknown",
  });
  for (const scope of ["optional.test", "optional.empty"]) {
    const root = graph.roots.find((entry) => entry.scope === scope)!;
    expect(graph.nodes.find((node) => node.id === root.node)?.dependencyCompleteness).toBe(
      "complete",
    );
  }
  expect(graph.edges).toEqual([
    expect.objectContaining({ requested: { name: "pytest", specifier: "pytest" } }),
  ]);
});

test("dynamic optional metadata leaves a static empty runtime scope known", () => {
  const result = pyprojectResult(
    '[project]\nname="app"\ndependencies=[]\ndynamic=["optional-dependencies"]\n',
    context,
  );
  const graph = result.graphs[0]!;
  expect(graph.rootCompleteness).toBe("unknown");
  expect(
    queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
  ).toBe("complete");
});

test.each([
  '[build-system]\nrequires=["setuptools"]\n',
  '[tool.flit.metadata]\nrequires=["requests"]\n',
  '[dependency-groups]\ndev=["pytest"]\n',
])("pyproject without supported project metadata keeps runtime coverage unknown: %s", (input) => {
  const result = pyprojectResult(input, context);
  validateResult(result);
  const graph = result.graphs[0]!;
  expect(graph.rootCompleteness).toBe("unknown");
  const root = graph.roots.find((entry) => entry.scope === "dependencies")!;
  expect(graph.nodes.find((node) => node.id === root.node)?.dependencyCompleteness).toBe("unknown");
  expect(queryDependencies(result, { graph: graph.id, root: root.id }).completeness).toBe(
    "unknown",
  );
  expect(
    result.issues.some((issue) => issue.code === "pyprojecttoml.unsupported_project_metadata"),
  ).toBe(true);
  if (input.includes("dependency-groups")) {
    const dev = graph.roots.find((entry) => entry.scope === "dev-dependencies")!;
    expect(graph.nodes.find((node) => node.id === dev.node)?.dependencyCompleteness).toBe(
      "complete",
    );
    expect(graph.edges.filter((edge) => edge.from === dev.node)).toHaveLength(1);
  }
});

test("static supported project metadata can establish an empty dependency scope", () => {
  const result = pyprojectResult('[project]\nname="empty"\ndependencies=[]\n', context);
  const graph = result.graphs[0]!;
  expect(graph.rootCompleteness).toBe("complete");
  expect(
    queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
  ).toBe("complete");
  expect(result.issues).toEqual([]);
});

test("Pipfile scopes retain different versions and missing adjacency", () => {
  const result = pipfileResult(
    JSON.stringify({
      default: { requests: { version: "==2.0", markers: "python_version < '3.12'" } },
      develop: { requests: { version: "==3.0" }, local: { path: "." } },
    }),
    context,
  );
  validateResult(result);
  expect(result.packages.map((pkg) => pkg.purl)).toEqual([
    "pkg:pypi/requests@2.0",
    "pkg:pypi/requests@3.0",
  ]);
  expect(
    result.graphs[0]!.nodes.filter((node) => !node.project).every(
      (node) => node.dependencyCompleteness === "unknown",
    ),
  ).toBe(true);
  expect(
    result.graphs[0]!.edges.some(
      (edge) => edge.status === "declared" && edge.requested.name === "local",
    ),
  ).toBe(true);
});

test.each(["poetrylock", "pdmlock"] as const)(
  "%s binds forward references without flattening ambiguous alternatives",
  (kind) => {
    const deps =
      kind === "poetrylock"
        ? '[package.dependencies]\nchild="*"\nalternative="*"\n'
        : 'dependencies=["child", "alternative"]\n';
    const result = lockResult(
      `[[package]]\nname="app"\nversion="1"\n${deps}\n[[package]]\nname="child"\nversion="2"\n[[package]]\nname="alternative"\nversion="1"\n[[package]]\nname="alternative"\nversion="2"\n`,
      context,
      kind,
    );
    validateResult(result);
    const edges = result.graphs[0]!.edges.filter((edge) => edge.from === "package:0");
    expect(edges.find((edge) => edge.requested?.name === "child")).toMatchObject({
      status: "resolved",
      to: "package:1",
    });
    expect(edges.find((edge) => edge.requested?.name === "alternative")).toMatchObject({
      status: "unresolved",
      attributes: { "python:candidateViews": ["package:2", "package:3"] },
    });
  },
);

test("Poetry optional marker requests retain native applicability and extras", () => {
  const result = lockResult(
    '[[package]]\nname="app"\nversion="1"\n[package.dependencies]\nchild={version="*", optional=true, extras=["speed"], markers="sys_platform == \'linux\'"}\n[[package]]\nname="child"\nversion="2"\n',
    context,
    "poetrylock",
  );
  const edge = result.graphs[0]!.edges.find((item) => item.from === "package:0")!;
  expect(edge).toMatchObject({
    status: "resolved",
    selection: "conditional",
    optional: true,
    requested: { features: ["speed"], condition: { language: "pep508" } },
  });
});

test("existing Python fixtures extract valid native graphs without snapshots", async () => {
  for (const [directory, extractor] of [
    ["requirementstxt", requirementsTxtExtractor],
    ["pyprojecttoml", pyprojectTomlExtractor],
    ["pipfilelock", pipfileLockExtractor],
    ["poetrylock", poetryLockExtractor],
    ["pdmlock", pdmLockExtractor],
  ] as const) {
    const fixtures = join(import.meta.dirname, directory, "__fixtures__");
    for (const name of await readdir(fixtures)) {
      const result = await extractor.extract(join(fixtures, name), undefined, {
        codebaseId: "example:fixtures",
      });
      validateResult(result);
      expect(result.graphs.length).toBeGreaterThan(0);
      expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
      if (directory === "poetrylock" || directory === "pdmlock") {
        expect(result.graphs.some((graph) => graph.interpretation === "declared")).toBe(true);
        expect(result.graphs.some((graph) => graph.interpretation === "locked")).toBe(true);
      }
    }
  }
});

test("incompatible ranges and source requests never select a name-only lock candidate", () => {
  const result = lockResult(
    '[[package]]\nname="app"\nversion="1"\n[package.dependencies]\nchild=">=2"\nother={git="https://example.com/other"}\n[[package]]\nname="child"\nversion="1"\n[[package]]\nname="other"\nversion="1"\n',
    context,
    "poetrylock",
  );
  expect(result.graphs[0]!.edges.find((edge) => edge.requested?.name === "child")).toMatchObject({
    status: "resolved",
    selection: "unknown",
  });
  expect(result.graphs[0]!.edges.find((edge) => edge.requested?.name === "other")).toMatchObject({
    status: "unresolved",
    selection: "unknown",
  });
});
