import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { queryDependencies, parseResult } from "@scatool/analyzer-core";

type LockPackage = {
  version: string;
  resolved: string;
  integrity: string;
  requires?: Record<string, string>;
  dependencies?: Record<string, LockPackage>;
};
test("scatool/demo-repository: pinned npm shrinkwrap records and conservative root correlation", async () => {
  const source = join(import.meta.dirname, "repositories/scatool+demo-repository") + "/";
  const manifest = JSON.parse(await readFile(source + "package.json", "utf8")) as {
    name: string;
    version: string;
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(await readFile(source + "npm-shrinkwrap.json", "utf8")) as {
    lockfileVersion: number;
    dependencies: Record<string, LockPackage>;
  };
  const result = parseResult(
    JSON.parse(
      await readFile(
        join(import.meta.dirname, "__snapshots__/scatool+demo-repository.json"),
        "utf8",
      ),
    ),
  );
  assert.equal(
    result.codebase,
    "integration:scatool/demo-repository@6f753a2b9f41332c074d48204fb63de3a471e76d",
  );
  assert.equal(lock.lockfileVersion, 1);
  assert.equal(result.graphs.length, 1);
  assert.equal(result.subprojects.length, 1);
  assert.deepEqual(result.issues, []);
  const graph = result.graphs[0],
    project = {
      purl: `pkg:npm/${manifest.name}@${manifest.version}`,
      definitionFile: "package.json",
    };
  assert.equal(graph.interpretation, "locked");
  assert.equal(graph.rootCompleteness, "complete");
  assert.deepEqual(graph.source, {
    extractor: "packagelockjson",
    files: ["npm-shrinkwrap.json", "package.json"],
  });
  assert.equal(result.subprojects[0].purl, project.purl);
  assert.equal(result.subprojects[0].definitionFile, project.definitionFile);
  const packages = Object.entries(lock.dependencies);
  assert.equal(packages.length, 9);
  assert.deepEqual(
    result.packages.map((x) => x.purl).sort((a, b) => a.localeCompare(b)),
    packages
      .map(([name, pkg]) => `pkg:npm/${name}@${pkg.version}`)
      .sort((a, b) => a.localeCompare(b)),
  );
  assert.equal(graph.nodes.length, 14);
  assert.equal(graph.edges.length, 10);
  const packageViews = graph.nodes.filter((x) => !x.project);
  assert.equal(packageViews.length, 9);
  let nativeEdgeCount = 0;
  for (const [name, pkg] of packages) {
    assert.equal(pkg.dependencies, undefined); // This exact source has no nested placements.
    const node = packageViews.find((x) => x.locator === `node_modules/${name}`);
    assert.ok(node);
    assert.equal(node.purl, `pkg:npm/${name}@${pkg.version}`);
    assert.equal(node.dependencyCompleteness, "complete");
    const artifact = {
      attributes: { "npm:integrity": pkg.integrity },
      evidence: ["npm-shrinkwrap.json"],
      location: pkg.resolved,
    };
    assert.deepEqual(node.artifacts, [artifact]);
    assert.deepEqual(result.packages.find((x) => x.purl === node.purl)!.artifacts, [artifact]);
    const outgoing = graph.edges.filter((x) => x.from === node.id);
    assert.equal(outgoing.length, Object.keys(pkg.requires ?? {}).length);
    for (const [dep, specifier] of Object.entries(pkg.requires ?? {})) {
      const edge = outgoing.find((x) => x.requested?.name === dep);
      assert.ok(edge);
      assert.ok(edge.requested);
      assert.equal(edge.requested.specifier, specifier);
      assert.ok(edge.status === "resolved");
      assert.equal(edge.selection, "selected");
      assert.equal(edge.relation, "depends-on");
      assert.equal(edge.kind, "dependencies");
      assert.equal(edge.optional, false);
      assert.equal(graph.nodes.find((x) => x.id === edge.to)!.locator, `node_modules/${dep}`);
      assert.deepEqual(edge.evidence, ["npm-shrinkwrap.json"]);
      nativeEdgeCount++;
    }
  }
  assert.equal(nativeEdgeCount, 8);
  assert.deepEqual(
    graph.roots.map((x) => x.scope).sort((a, b) => a.localeCompare(b)),
    ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  for (const node of graph.nodes.filter((x) => x.project)) {
    assert.deepEqual(node.project, project);
    assert.equal(node.dependencyCompleteness, "complete");
    const edges = graph.edges.filter((x) => x.from === node.id);
    const root = graph.roots.find((x) => x.node === node.id);
    const expected = root && root.scope !== "dependencies" ? {} : manifest.dependencies;
    assert.equal(edges.length, Object.keys(expected).length);
    for (const [name, specifier] of Object.entries(expected)) {
      const edge = edges.find((x) => x.requested?.name === name);
      assert.ok(edge);
      assert.ok(edge.requested);
      assert.equal(edge.requested.specifier, specifier);
      assert.ok(edge.status === "resolved");
      assert.equal(edge.selection, "unknown");
      assert.equal(edge.relation, "depends-on");
      assert.equal(graph.nodes.find((x) => x.id === edge.to)!.locator, `node_modules/${name}`);
      assert.deepEqual(edge.evidence, ["npm-shrinkwrap.json", "package.json"]);
    }
  }
  for (const root of graph.roots) {
    const closure = queryDependencies(result, { graph: graph.id, root: root.id });
    assert.deepEqual(closure.definite, []);
    assert.deepEqual(closure.declarations, []);
    if (root.scope === "dependencies") {
      assert.deepEqual(
        closure.conditional
          .map((id) => graph.nodes.find((n) => n.id === id)!.purl)
          .sort((a, b) => a.localeCompare(b)),
        result.packages.map((p) => p.purl).sort((a, b) => a.localeCompare(b)),
      );
      assert.equal(closure.completeness, "partial");
    } else {
      assert.deepEqual(closure.conditional, []);
      assert.equal(closure.completeness, "complete");
    }
  }
});
