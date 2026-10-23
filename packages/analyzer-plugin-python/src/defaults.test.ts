import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { validateResultV2, type AnalyzerResultV2 } from "@scatool/analyzer-core";
import {
  requirementsTxtExtractor,
  pyprojectTomlExtractor,
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
} from "./index.ts";
const path = (folder: string, fixture: string) =>
  join(import.meta.dirname, folder, "__fixtures__", fixture);
const names = (result: AnalyzerResultV2) =>
  result.graphs
    .flatMap((graph) =>
      graph.edges.flatMap((edge) => (edge.requested?.name ? [edge.requested.name] : [])),
    )
    .sort((a, b) => String(a).localeCompare(String(b)));
const purls = (result: AnalyzerResultV2) => result.packages.map((pkg) => pkg.purl);
const basic = [
  "certifi@2023.7.22",
  "charset-normalizer@3.2.0",
  "idna@3.4",
  "requests@2.31.0",
  "urllib3@2.0.4",
].map((item) => `pkg:pypi/${item}`);

test.each([
  ["basic", ["django", "flask", "requests"]],
  ["dev-deps", ["black", "flask", "pytest", "pytest-cov", "requests"]],
  ["with-versions", ["django", "flask", "pytest", "requests", "sqlalchemy"]],
] as const)(
  "requirements default preserves %s requests without fabricated selected versions",
  async (fixture, expected) => {
    const result = await requirementsTxtExtractor.extract(path("requirementstxt", fixture));
    validateResultV2(result);
    expect(names(result)).toEqual(expected);
    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.graphs.every((graph) => graph.interpretation === "declared")).toBe(true);
    if (fixture === "with-versions")
      expect(
        result.graphs[0]!.edges.find((edge) => edge.requested?.name === "django")?.requested
          ?.specifier,
      ).toBe("django>=4.2.0,<5.0.0");
  },
);

test("unsupported requirement forms remain declarations and includes retain missing coverage", async () => {
  const result = await requirementsTxtExtractor.extract(path("requirementstxt", "unsupported"));
  validateResultV2(result);
  const edges = result.graphs[0]!.edges;
  expect(edges).toHaveLength(7);
  expect(edges.some((edge) => edge.requested?.specifier === "-e .")).toBe(true);
  expect(
    edges.some((edge) =>
      edge.requested?.specifier?.startsWith("https://example.com/packages/unnamed"),
    ),
  ).toBe(true);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "requirementstxt.include_not_followed",
  );
});

test("ANSI requirements are a visible extraction error with unknown graph coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "python-default-error-"));
  try {
    await writeFile(join(dir, "requirements.txt"), "\u001b[31mrequests==2.32.0\u001b[0m\n");
    const result = await requirementsTxtExtractor.extract(dir);
    validateResultV2(result);
    expect(result.issues.some((issue) => issue.severity === "ERROR")).toBe(true);
    expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([
  [
    "basic",
    "pkg:pypi/sample-app@1.2.3",
    ["FastAPI", "local-lib", "mkdocs", "mypy", "pydantic-settings", "pytest", "ruff"],
  ],
  ["poetry", "pkg:pypi/poetry-app@0.2.0", ["Django", "pytest", "requests"]],
  ["with-lock", "pkg:pypi/locked-project@1.0.0", ["requests"]],
] as const)(
  "pyproject default retains %s project and declarations even beside a lock",
  async (fixture, purl, expected) => {
    const result = await pyprojectTomlExtractor.extract(path("pyprojecttoml", fixture));
    validateResultV2(result);
    expect(result.subprojects[0]!.purl).toBe(purl);
    expect(names(result)).toEqual(expected);
    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([]);
    if (fixture === "basic")
      expect(
        result.graphs[0]!.roots.map((root) => root.scope).sort((a, b) =>
          String(a).localeCompare(String(b)),
        ),
      ).toEqual(["dependencies", "dev-dependencies", "optional.dev", "optional.docs"]);
  },
);

test.each([
  ["basic", basic],
  [
    "dev-deps",
    ["click@8.1.7", "flask@2.3.3", "pytest@7.4.2", "pytest-cov@4.1.0"]
      .map((item) => `pkg:pypi/${item}`)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ],
] as const)(
  "Pipfile default preserves %s versions, lock categories and unknown adjacency",
  async (fixture, expected) => {
    const result = await pipfileLockExtractor.extract(path("pipfilelock", fixture));
    validateResultV2(result);
    expect(purls(result)).toEqual(expected);
    expect(
      result.graphs[0]!.roots.map((root) => root.scope).sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    ).toEqual(["locked-group:default", "locked-group:develop"]);
    expect(
      result.graphs[0]!.nodes.filter((node) => !node.project).every(
        (node) => node.dependencyCompleteness === "unknown",
      ),
    ).toBe(true);
    expect(result.graphs[0]!.nodes.some((node) => node.attributes?.["pipenv:record"])).toBe(true);
    expect(result.issues).toEqual([]);
  },
);

test.each([
  ["poetrylock", poetryLockExtractor, "basic", basic, ["requests"]],
  [
    "poetrylock",
    poetryLockExtractor,
    "with-groups",
    ["asgiref@3.7.2", "black@23.9.1", "django@4.2.5", "pytest@7.4.2", "sqlparse@0.4.4"].map(
      (item) => `pkg:pypi/${item}`,
    ),
    ["black", "django", "pytest"],
  ],
  ["pdmlock", pdmLockExtractor, "basic", basic, ["requests"]],
  [
    "pdmlock",
    pdmLockExtractor,
    "with-groups",
    [
      "black@23.9.1",
      "click@8.1.7",
      "flask@2.3.3",
      "pytest@7.4.2",
      "pytest-cov@4.1.0",
      "werkzeug@2.3.7",
    ]
      .map((item) => `pkg:pypi/${item}`)
      .sort((a, b) => String(a).localeCompare(String(b))),
    ["black", "flask", "pytest", "pytest-cov"],
  ],
] as const)(
  "%s default retains %s native lock and current manifest observations",
  async (folder, extractor, fixture, expected, direct) => {
    const result = await extractor.extract(path(folder, fixture));
    validateResultV2(result);
    expect(purls(result)).toEqual(expected);
    expect(result.issues).toEqual([]);
    const locked = result.graphs.find((graph) => graph.interpretation === "locked")!;
    const declared = result.graphs.find((graph) => graph.interpretation === "declared")!;
    expect(
      declared.edges
        .map((edge) => edge.requested!.name)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(direct);
    expect(declared.edges.every((edge) => edge.status === "declared")).toBe(true);
    expect(locked.nodes.filter((node) => !node.project)).toHaveLength(expected.length);
    if (fixture === "basic") {
      const node = locked.nodes.find((node) => node.purl === "pkg:pypi/requests@2.31.0")!;
      expect(
        locked.edges
          .filter((edge) => edge.from === node.id)
          .map((edge) => edge.requested!.name)
          .sort((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(["certifi", "charset-normalizer", "idna", "urllib3"]);
    }
  },
);
