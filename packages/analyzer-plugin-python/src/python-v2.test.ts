import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependenciesV2, validateResultV2 } from "@scatool/analyzer-core";
import {
  lockResult,
  pipfileResult,
  pyprojectResult,
  requirementsResult,
  requirementsTxtExtractorV2,
  pyprojectTomlExtractorV2,
  pipfileLockExtractorV2,
  poetryLockExtractorV2,
  pdmLockExtractorV2,
} from "./python-v2.ts";
const context = { codebaseId: "example:python", codebasePath: "/example", relativeFile: "input" };

test("requirements retain original version requests, markers, extras and unknown included inputs", () => {
  const result = requirementsResult(
    'requests[security]>=2; python_version < "3.12"\n-r other.txt\n-e git+https://example.com/project#egg=local\n',
    context,
  );
  validateResultV2(result);
  expect(result.packages).toEqual([]);
  const graph = result.graphs[0]!;
  expect(graph.edges.find((edge) => edge.requested?.name === "requests")).toMatchObject({
    status: "declared",
    selection: "conditional",
    requested: { features: ["security"], condition: { language: "pep508" } },
  });
  expect(graph.edges.some((edge) => edge.requested?.specifier === "-r other.txt")).toBe(true);
  expect(
    queryDependenciesV2(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
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
  validateResultV2(result);
  expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  expect(result.graphs[0]!.edges).toHaveLength(2);
  expect(result.graphs[0]!.nodes[0]!.dependencyCompleteness).toBe("unknown");
});

test("Pipfile scopes retain different versions and missing adjacency", () => {
  const result = pipfileResult(
    JSON.stringify({
      default: { requests: { version: "==2.0", markers: "python_version < '3.12'" } },
      develop: { requests: { version: "==3.0" }, local: { path: "." } },
    }),
    context,
  );
  validateResultV2(result);
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
    validateResultV2(result);
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

test("existing Python fixtures extract valid native V2 graphs without snapshots", async () => {
  for (const [directory, extractor] of [
    ["requirementstxt", requirementsTxtExtractorV2],
    ["pyprojecttoml", pyprojectTomlExtractorV2],
    ["pipfilelock", pipfileLockExtractorV2],
    ["poetrylock", poetryLockExtractorV2],
    ["pdmlock", pdmLockExtractorV2],
  ] as const) {
    const fixtures = join(import.meta.dirname, directory, "__fixtures__");
    for (const name of await readdir(fixtures)) {
      const result = await extractor.extract(join(fixtures, name), undefined, {
        codebaseId: "example:fixtures",
      });
      validateResultV2(result);
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
