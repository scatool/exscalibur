import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { test } from "vite-plus/test";
import { parse as toml } from "smol-toml";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";

// Preserve default JavaScript lexicographic ordering for native scalar tuples.
function sortText(value: unknown): string {
  if (Array.isArray(value)) return value.map(sortText).join(",");
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new TypeError("Expected a scalar or tuple sort key");
}
function compareNative(a: unknown, b: unknown): number {
  const left = sortText(a),
    right = sortText(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function nativeString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a native string");
  return value;
}
type Data = Record<string, unknown>;
const table = (value: unknown): Data => (value ?? {}) as Data;
const list = (value: unknown): unknown[] => (value ?? []) as unknown[];
const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
const read = (path: string) => readFile(path, "utf8");
async function paths(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? paths(join(directory, entry.name), prefix + entry.name + "/")
          : [prefix + entry.name],
      ),
    )
  ).flat();
}
const cases = [
  "Textualize+rich",
  "encode+httpx",
  "pdm-project+pdm",
  "pypa+pipenv",
  "django+django",
];

// pip's requirements parser recognizes these names in the pinned native inputs.
// Retaining the URL string alone must not hide loss of its declared package identity.
for (const fixture of [
  {
    id: "pdm-project+pdm",
    file: "tests/fixtures/requirements.txt",
    specifier:
      "git+https://github.com/techalchemy/test-project.git@master#egg=pep508-package&subdirectory=parent_folder/pep508-package",
    name: "pep508-package",
  },
  {
    id: "sharkdp+bat",
    file: "tests/syntax-tests/source/Requirements.txt/requirements.txt",
    specifier: "https://github.com/pallets/click/archive/7.0.zip#egg=click",
    name: "click",
  },
]) {
  test(`${fixture.id}: legacy URL requirements retain their declared names`, async () => {
    const source = await read(join(import.meta.dirname, "repositories", fixture.id, fixture.file));
    assert.ok(source.split(/\r?\n/).includes(fixture.specifier));

    const result = parseResult(
      JSON.parse(await read(join(import.meta.dirname, "__snapshots__", `${fixture.id}.json`))),
    );
    const graph = result.graphs.find(
      (candidate) =>
        candidate.source.extractor === "requirementstxt" &&
        candidate.source.files.includes(fixture.file),
    )!;
    const edge = graph.edges.find(
      (candidate) => candidate.requested?.specifier === fixture.specifier,
    )!;
    assert.equal(edge.requested?.name, fixture.name);
    assert.equal(edge.status, "declared");
    assert.equal("to" in edge, false);
    assert.equal(
      queryDependencies(result, { graph: graph.id, root: graph.roots[0]!.id }).completeness,
      "unknown",
    );
  });
}

for (const id of cases)
  test(`${id}: all native Python inputs and conservative graph semantics`, async () => {
    const source = join(import.meta.dirname, "repositories", id);
    const result = parseResult(
      JSON.parse(await read(join(import.meta.dirname, "__snapshots__", `${id}.json`))),
    );
    const inputPaths = (await paths(source))
      .filter((path) =>
        /(?:^|\/)(?:pyproject\.toml|poetry\.lock|pdm\.lock|Pipfile\.lock|requirements[^/]*\.txt|package\.json)$/.test(
          path,
        ),
      )
      .sort(compareNative);
    // The full recovered tree was inventoried: none of the other 16 configured extractor
    // patterns match in this group. Every matching manifest/lock/requirements file is checked.
    assert.deepEqual(
      [...new Set(result.graphs.flatMap((graph) => graph.source.files))].sort(compareNative),
      inputPaths,
    );
    assert.equal(result.issues.filter((issue) => issue.severity === "ERROR").length, 0);
    const catalog = new Set<string>();
    const expectedIssues: string[] = [];
    for (const file of inputPaths) {
      const content = await read(join(source, file));
      const graphs = result.graphs.filter((graph) => graph.source.files.includes(file));
      assert.ok(graphs.length > 0, file);
      const filename = basename(file);
      if (filename === "pyproject.toml") {
        const native = table(toml(content));
        if (native.project === undefined && table(native.tool).poetry === undefined)
          expectedIssues.push(`${file}:pyprojecttoml.unsupported_project_metadata`);
        const project = table(native.project),
          poetry = table(table(native.tool).poetry);
        const declarations: {
          scope: string;
          specifier: string;
          name?: string;
          native?: unknown;
        }[] = [];
        const scopes = new Set<string>();
        const strings = (scope: string, values: unknown) => {
          scopes.add(scope);
          for (const specifier of list(values)) {
            assert.equal(typeof specifier, "string");
            declarations.push({ scope, specifier: String(specifier) });
          }
        };
        const named = (scope: string, values: unknown) => {
          scopes.add(scope);
          for (const [name, value] of Object.entries(table(values))) {
            if (name === "python") continue;
            for (const declaration of Array.isArray(value) ? value : [value])
              declarations.push({
                scope,
                name,
                specifier:
                  typeof declaration === "string"
                    ? declaration
                    : nativeString(table(declaration).version ?? "*"),
                native: declaration,
              });
          }
        };
        if (project.dependencies !== undefined) strings("dependencies", project.dependencies);
        for (const [group, values] of Object.entries(table(project["optional-dependencies"])))
          strings(`optional.${group}`, values);
        assert.equal(table(table(native.tool).pdm)["dev-dependencies"], undefined);
        assert.equal(table(table(native.tool).uv)["dev-dependencies"], undefined);
        if (poetry.dependencies !== undefined) named("dependencies", poetry.dependencies);
        if (poetry["dev-dependencies"] !== undefined)
          named("dev-dependencies", poetry["dev-dependencies"]);
        for (const [group, value] of Object.entries(table(poetry.group)))
          named(`group.${group}`, table(value).dependencies);
        for (const [group, value] of Object.entries(table(native["dependency-groups"])))
          strings(group === "dev" ? "dev-dependencies" : `group.${group}`, value);
        for (const graph of graphs.filter((graph) => graph.source.extractor === "pyprojecttoml")) {
          assert.equal(graph.interpretation, "declared");
          assert.deepEqual(graph.attributes?.["python:manifest"], native);
          assert.deepEqual(
            graph.roots.map((root) => root.scope).sort(compareNative),
            [...(scopes.size ? scopes : ["dependencies"])].sort(compareNative),
          );
          assert.equal(graph.edges.length, declarations.length);
          for (const root of graph.roots) {
            const expected = declarations.filter((item) => item.scope === root.scope);
            const edges = graph.edges.filter((edge) => edge.from === root.node);
            assert.deepEqual(
              edges.map((edge) => edge.requested?.specifier).sort(compareNative),
              expected.map((item) => item.specifier).sort(compareNative),
            );
            for (const declaration of expected) {
              const edge = edges.find(
                (edge) =>
                  edge.requested?.specifier === declaration.specifier &&
                  (!declaration.name || edge.requested.name === declaration.name),
              );
              assert.ok(edge);
              assert.equal(edge.status, "declared");
              assert.equal("to" in edge, false);
              if (declaration.native !== undefined)
                assert.deepEqual(
                  edge.requested?.attributes?.["python:declaration"],
                  declaration.native,
                );
              if (declaration.specifier.includes(";"))
                assert.equal(
                  edge.requested?.condition?.expression,
                  declaration.specifier.split(";").slice(1).join(";").trim(),
                );
              const fields = table(
                typeof declaration.native === "object" ? declaration.native : undefined,
              );
              if (fields.optional || fields.markers || fields.platform || fields.python) {
                assert.equal(edge.selection, "conditional");
                assert.deepEqual(edge.condition?.expression, declaration.native);
              }
            }
            const closure = queryDependencies(result, { graph: graph.id, root: root.id });
            assert.deepEqual(closure.definite, []);
            assert.deepEqual(closure.conditional, []);
            if (expected.length) assert.equal(closure.completeness, "unknown");
            // An unsupported/build-system-only project does not establish dependency-free coverage.
            if (native.project === undefined && table(native.tool).poetry === undefined) {
              assert.equal(graph.rootCompleteness, "unknown");
              assert.equal(closure.completeness, "unknown");
            }
          }
        }
      } else if (filename.startsWith("requirements")) {
        const graph = graphs.find((graph) => graph.source.extractor === "requirementstxt")!;
        assert.equal(graph.interpretation, "declared");
        const records = content
          .replace(/\\\r?\n/g, " ")
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+#.*$/, "").trim())
          .filter((line) => line && !line.startsWith("#"));
        const options = records.filter(
          (line) => line.startsWith("--index-url") || line.startsWith("--extra-index-url"),
        );
        const requests = records.filter((line) => !options.includes(line));
        for (const _option of options)
          expectedIssues.push(`${file}:requirementstxt.option_preserved`);
        for (const _include of requests.filter((line) => line.startsWith("-r ")))
          expectedIssues.push(`${file}:requirementstxt.include_not_followed`);
        assert.deepEqual(
          graph.edges.map((edge) => edge.requested?.specifier).sort(compareNative),
          requests.sort(compareNative),
        );
        assert.deepEqual(graph.nodes[0]!.attributes?.["python:options"] ?? [], options);
        for (const edge of graph.edges) {
          const spec = edge.requested!.specifier!;
          assert.equal("to" in edge, false);
          if (spec.startsWith("-r ")) {
            assert.equal(edge.status, "unresolved");
            assert.equal(edge.selection, "unknown");
            assert.equal(graph.nodes[0]!.dependencyCompleteness, "partial");
            assert.ok(
              result.issues.some(
                (issue) =>
                  issue.file === file && issue.code === "requirementstxt.include_not_followed",
              ),
            );
          } else {
            assert.equal(edge.status, "declared");
            if (spec.includes(";")) {
              assert.equal(edge.selection, "conditional");
              assert.equal(edge.condition?.expression, spec.split(";").slice(1).join(";").trim());
            } else assert.equal(edge.selection, "selected");
          }
        }
      } else if (filename === "Pipfile.lock") {
        const native = JSON.parse(content) as Data;
        const graph = graphs.find((graph) => graph.source.extractor === "pipfilelock")!;
        assert.equal(graph.interpretation, "locked");
        assert.equal(graph.rootCompleteness, "unknown");
        let count = 0;
        for (const scope of ["default", "develop"]) {
          const entries = Object.entries(table(native[scope]));
          const root = graph.roots.find((root) => root.scope === `locked-group:${scope}`);
          if (native[scope] === undefined) {
            assert.equal(root, undefined);
            continue;
          }
          assert.ok(root);
          assert.equal(
            graph.edges.filter((edge) => edge.from === root.node).length,
            entries.length,
          );
          for (const [name, value] of entries) {
            const record = table(value);
            const version = nativeString(record.version ?? "");
            if (!/^==[^*=!<>~]+$/.test(version)) {
              assert.ok(
                graph.edges.some(
                  (edge) =>
                    edge.from === root.node &&
                    edge.status === "declared" &&
                    edge.requested?.name === name,
                ),
              );
              continue;
            }
            const purl = `pkg:pypi/${normalize(name)}@${version.slice(2)}`;
            catalog.add(purl);
            const node = graph.nodes.find((node) => node.id === JSON.stringify([scope, name]));
            assert.ok(node);
            assert.equal(node.purl, purl);
            assert.equal(node.dependencyCompleteness, "unknown");
            assert.deepEqual(node.attributes?.["pipenv:record"], record);
            const binding = graph.edges.find(
              (edge) => edge.status === "resolved" && edge.to === node.id,
            )!;
            assert.equal(binding.from, root.node);
            assert.equal(binding.selection, record.markers ? "conditional" : "selected");
            if (record.markers) assert.equal(binding.condition?.expression, record.markers);
            count++;
          }
        }
        assert.equal(graph.nodes.filter((node) => !node.project).length, count);
        for (const root of graph.roots)
          assert.equal(
            queryDependencies(result, { graph: graph.id, root: root.id }).completeness,
            "unknown",
          );
      } else if (filename === "poetry.lock" || filename === "pdm.lock") {
        const native = table(toml(content));
        const records = list(native.package).map(table);
        const graph = graphs.find(
          (graph) =>
            graph.source.extractor === (filename === "poetry.lock" ? "poetrylock" : "pdmlock"),
        )!;
        assert.equal(graph.interpretation, "locked");
        assert.equal(graph.rootCompleteness, "unknown");
        assert.equal(graph.nodes.filter((node) => !node.project).length, records.length);
        records.forEach((record, index) => {
          const node = graph.nodes.find((node) => node.id === `package:${index}`);
          assert.ok(node);
          assert.deepEqual(node.attributes?.["python:lockRecord"], record);
          assert.equal(node.dependencyCompleteness, "complete");
          assert.equal(
            node.purl,
            `pkg:pypi/${normalize(String(record.name))}@${nativeString(record.version)}`,
          );
          catalog.add(node.purl);
          const requests: { name?: string; specifier: string; native?: unknown }[] =
            filename === "pdm.lock"
              ? list(record.dependencies).map((spec) => ({ specifier: String(spec) }))
              : Object.entries(table(record.dependencies)).flatMap(([name, value]) =>
                  (Array.isArray(value) ? value : [value]).map((item) => ({
                    name,
                    specifier:
                      typeof item === "string" ? item : nativeString(table(item).version ?? "*"),
                    native: item,
                  })),
                );
          const outgoing = graph.edges.filter((edge) => edge.from === node.id);
          assert.equal(
            outgoing.length,
            requests.filter((request) => request.name !== "python").length,
          );
          for (const req of requests.filter((request) => request.name !== "python")) {
            const edge = outgoing.find(
              (edge) =>
                edge.requested?.specifier === req.specifier &&
                (!req.name || edge.requested.name === req.name),
            );
            assert.ok(edge);
            if (req.native !== undefined)
              assert.deepEqual(edge.requested?.attributes?.["python:declaration"], req.native);
            if (edge.status === "resolved") {
              const target = graph.nodes.find((node) => node.id === edge.to)!;
              const targetRecord = table(target.attributes?.["python:lockRecord"]);
              assert.equal(normalize(String(targetRecord.name)), normalize(edge.requested!.name!));
              const exact = req.specifier.match(/==([^;\s]+)(?:\s*;.*)?$/)?.[1];
              if (exact) assert.equal(targetRecord.version, exact);
              else if (
                req.specifier !== "*" &&
                normalize(req.specifier.split(";")[0]!.trim()) !== normalize(edge.requested!.name!)
              )
                assert.equal(edge.selection, "unknown");
            } else {
              assert.equal(edge.status, "unresolved");
              assert.equal("to" in edge, false);
            }
          }
          const nativeGroups = Array.isArray(record.groups)
            ? record.groups
            : record.category
              ? [record.category]
              : [];
          const scopes = nativeGroups.length
            ? nativeGroups.map((group) => `locked-group:${group}`)
            : ["locked-packages"];
          const memberships = graph.edges.filter(
            (edge) =>
              edge.status === "resolved" &&
              edge.to === node.id &&
              graph.roots.some((root) => root.node === edge.from),
          );
          assert.deepEqual(
            memberships
              .map((edge) => graph.roots.find((root) => root.node === edge.from)!.scope)
              .sort(compareNative),
            scopes.sort(compareNative),
          );
          const guarded = [
            "markers",
            "marker",
            "python-versions",
            "requires_python",
            "requires-python",
            "optional",
          ].some(
            (key) => record[key] !== undefined && record[key] !== false && record[key] !== "*",
          );
          for (const edge of memberships)
            assert.equal(edge.selection, guarded ? "conditional" : "selected");
        });
        // These pinned lock groups contain guarded membership, uncertain range bindings or
        // unresolved candidate alternatives; none establishes a complete environment closure.
        for (const root of graph.roots)
          assert.equal(
            queryDependencies(result, { graph: graph.id, root: root.id }).completeness,
            "partial",
          );
      } else if (filename === "package.json") {
        const manifest = JSON.parse(content) as Data;
        const graph = graphs[0]!;
        assert.equal(id, "django+django");
        assert.equal(graph.interpretation, "declared");
        const root = graph.roots.find((root) => root.scope === "devDependencies")!;
        assert.deepEqual(
          graph.edges
            .filter((edge) => edge.from === root.node)
            .map((edge) => [edge.requested?.name, edge.requested?.specifier])
            .sort(compareNative),
          Object.entries(table(manifest.devDependencies)).sort(compareNative),
        );
        for (const edge of graph.edges) assert.equal(edge.status, "declared");
      }
    }
    assert.deepEqual(
      result.issues.map((issue) => `${issue.file}:${issue.code}`).sort(compareNative),
      expectedIssues.sort(compareNative),
    );
    assert.deepEqual(
      result.packages.map((pkg) => pkg.purl).sort(compareNative),
      [...catalog].sort(compareNative),
    );
  });
