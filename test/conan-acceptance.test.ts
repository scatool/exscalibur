import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";

const id = "drogonframework+drogon";
const source = join(import.meta.dirname, "repositories", id);
const commit = "9784c612762b106adf70a713cf68384d909d2141";
const gitTree = "f2262e446fadf4e7b4830be823678366c73ae6a3";
const trantor = "63a4e5e164e219dc3bf30cdbfa1462ae5602fa97";
const profile = "../packages/analyzer-plugin-conan/src/__fixtures__/profile";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const objectHash = (kind: string, bytes: Buffer) =>
  createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest();

// Reconstruct the pinned superproject tree. The archive omits the contents of
// its trantor gitlink; that omission must not imply recursive source coverage.
function sourceTree(directory = "", paths: string[] = []): { hash: Buffer; paths: string[] } {
  const entries = readdirSync(join(source, directory)).map((name) => {
    const relative = directory ? `${directory}/${name}` : name;
    const path = join(source, relative);
    const stat = lstatSync(path);
    let mode: string;
    let digest: Buffer;
    if (relative === "trantor") {
      assert.ok(stat.isDirectory());
      assert.deepEqual(readdirSync(path), [], "unreviewed submodule contents are not accepted");
      mode = "160000";
      digest = Buffer.from(trantor, "hex");
    } else if (stat.isDirectory()) {
      mode = "40000";
      digest = sourceTree(relative, paths).hash;
    } else {
      paths.push(relative);
      mode = stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
      digest = objectHash(
        "blob",
        stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path),
      );
    }
    return {
      order: name + (mode === "40000" ? "/" : ""),
      bytes: Buffer.concat([Buffer.from(`${mode} ${name}\0`), digest]),
    };
  });
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)));
  return { hash: objectHash("tree", Buffer.concat(entries.map((entry) => entry.bytes))), paths };
}

test("Drogon: pinned superproject, omitted gitlink and configured Conan profile", () => {
  const tree = sourceTree();
  assert.equal(tree.hash.toString("hex"), gitTree);
  const inputNames = new Set([
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "Cargo.lock",
    "Cargo.toml",
    "go.mod",
    "build.gradle",
    "build.gradle.kts",
    "Pipfile.lock",
    "poetry.lock",
    "pdm.lock",
    "pyproject.toml",
    "conanfile.py",
    "conanfile.txt",
    "vcpkg.json",
  ]);
  assert.deepEqual(
    tree.paths
      .filter((path) => {
        const name = path.split("/").at(-1)!;
        return inputNames.has(name) || /^requirements.*\.txt$/.test(name);
      })
      .sort(),
    ["conanfile.txt"],
  );
  assert.equal(
    sha256(readFileSync(join(source, "conanfile.txt"))),
    "99afb2de0ca01646c9fad60cd0057d7553dd7b4a95fbc41a3f4d678b47bff6e2",
  );
  assert.equal(
    sha256(readFileSync(join(source, ".gitmodules"))),
    "ccab9449963fae3c7df263bb9785ecc108c83d24396b6ad71ef87e746ba0f178",
  );
  assert.equal(
    sha256(readFileSync(join(import.meta.dirname, profile))),
    "e6d0ae52aa4699062daeb264a1def01bf07cde87e3601da67d6c573eeb910079",
  );
  const configurations = JSON.parse(
    readFileSync(join(import.meta.dirname, "repositories.json"), "utf8"),
  );
  const config = configurations.find(
    (value: { owner: string; repository: string }) => `${value.owner}+${value.repository}` === id,
  );
  assert.equal(config.commit, commit);
  assert.deepEqual(config.options, {
    conanfile: { profileBuild: profile, profileHost: profile, conanArgs: ["--build", "*"] },
  });
});

test("Drogon: native Conan selections, requirement traits and exact scoped queries", () => {
  const bytes = readFileSync(join(import.meta.dirname, "acceptance/conan-native-drogon.json"));
  assert.equal(sha256(bytes), "0c91c37385b99d6021d32b0e17fdfaa5c44aaa6315247bfb9ee6e61b7f1cfb7c");
  const native = JSON.parse(bytes.toString()).graph;
  assert.deepEqual(native.root, { "0": "None" });
  assert.equal(native.error, null);
  assert.deepEqual(native.overrides, {});
  assert.deepEqual(native.resolved_ranges, {});
  assert.deepEqual(native.replaced_requires, {});
  const manifest = readFileSync(join(source, "conanfile.txt"), "utf8");
  const requires = manifest
    .split("[requires]")[1]!
    .split("[")[0]!
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(requires, [
    "brotli/1.0.9",
    "gtest/1.10.0",
    "hiredis/1.0.0",
    "jsoncpp/1.9.4",
    "openssl/1.1.1t",
    "sqlite3/3.40.1",
    "zlib/1.2.11",
  ]);
  assert.deepEqual(
    Object.values(native.nodes["0"].dependencies)
      .map((dep) => (dep as { require: string }).require)
      .sort(),
    requires,
  );
  const result = parseResult(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
  );
  assert.equal(result.codebase, `integration:drogonframework/drogon@${commit}`);
  assert.deepEqual(result.issues, []);
  assert.equal(result.graphs.length, 1);
  assert.equal(result.packages.length, 7);
  assert.equal(result.subprojects.length, 1);
  const project = { purl: "pkg:conan/project", definitionFile: "conanfile.txt#node=0" };
  assert.deepEqual(result.subprojects[0], {
    ...project,
    identityObservations: [
      {
        source: { extractor: "conanfile", files: ["conanfile.txt"], key: "0" },
        synthesizedPurl: true,
      },
    ],
  });
  const graph = result.graphs[0]!;
  assert.equal(graph.interpretation, "resolved");
  assert.equal(graph.rootCompleteness, "complete");
  assert.deepEqual(graph.source, { extractor: "conanfile", files: ["conanfile.txt"] });
  assert.deepEqual(graph.context, {
    "conan:arguments": ["--build", "*"],
    "conan:profileBuild": profile,
    "conan:profileHost": profile,
  });
  assert.equal(graph.nodes.length, 11);
  assert.equal(graph.edges.length, 14);
  assert.deepEqual(graph.roots.map((root) => root.scope).sort(), ["build", "runtime", "test"]);
  const selectedIds = Object.keys(native.nodes)
    .filter((key) => key !== "0")
    .sort();
  assert.deepEqual(selectedIds, ["1", "2", "3", "4", "5", "6", "7"]);
  const purls: string[] = [];
  for (const [key, record] of Object.entries(native.nodes) as [string, any][]) {
    const node = graph.nodes.find((node) => node.id === key)!;
    assert.ok(node);
    assert.equal(node.locator, key);
    assert.equal(node.dependencyCompleteness, "complete");
    assert.deepEqual(node.evidence, ["conanfile.txt"]);
    const attributes = Object.fromEntries(
      ["context", "package_id", "prev", "binary", "settings", "options", "ref", "test"].map(
        (field) => [`conan:${field}`, record[field]],
      ),
    );
    assert.deepEqual(node.attributes, attributes);
    assert.equal(record.context, "host");
    assert.equal(record.test, false);
    assert.equal(record.settings["compiler.version"], "15");
    if (key === "0") {
      assert.deepEqual(node.project, project);
      assert.equal(node.purl, project.purl);
    } else {
      const purl = `pkg:conan/${record.name}@${record.version}?rrev=${record.rrev}`;
      purls.push(purl);
      assert.equal(node.purl, purl);
      assert.equal(node.project, undefined);
      assert.equal(record.binary, "Build"); // graph planning, not a completed build
      assert.equal(record.prev, null);
      assert.deepEqual(record.dependencies, {});
      assert.deepEqual(
        graph.edges.filter((edge) => edge.from === key),
        [],
      );
    }
  }
  assert.deepEqual(result.packages.map((pkg) => pkg.purl).sort(), purls.sort());
  for (const pkg of result.packages) assert.deepEqual(pkg.evidence, ["conanfile.txt"]);
  for (const root of graph.roots) {
    assert.deepEqual(root.project, project);
    const node = graph.nodes.find((node) => node.id === root.node)!;
    assert.deepEqual(node, { ...graph.nodes.find((node) => node.id === "0")!, id: root.node });
    const closure = queryDependencies(result, { graph: graph.id, root: root.id });
    assert.equal(closure.completeness, "complete");
    assert.deepEqual(closure.definite, root.scope === "runtime" ? selectedIds : []);
    assert.deepEqual(closure.conditional, []);
    assert.deepEqual(closure.declarations, []);
  }
  const runtime = graph.roots.find((root) => root.scope === "runtime")!;
  for (const from of ["0", runtime.node]) {
    const outgoing = graph.edges.filter((edge) => edge.from === from);
    assert.deepEqual(
      outgoing.map((edge) => (edge.status === "resolved" ? edge.to : "unresolved")).sort(),
      selectedIds,
    );
    for (const edge of outgoing) {
      assert.equal(edge.status, "resolved");
      if (edge.status !== "resolved") throw new Error("Expected native selected binding");
      const requirement = native.nodes["0"].dependencies[edge.to];
      assert.equal(requirement.direct, true);
      assert.equal(requirement.build, false);
      assert.equal(requirement.test, false);
      assert.equal(requirement.run, false); // ordinary library requirement, not proof of runtime use
      assert.deepEqual(edge, {
        from,
        to: edge.to,
        relation: "depends-on",
        kind: "runtime",
        status: "resolved",
        selection: "selected",
        evidence: ["conanfile.txt"],
        requested: {
          specifier: requirement.require,
          attributes: { "conan:requirement": requirement },
        },
      });
    }
  }
  assert.ok(!JSON.stringify(result).includes(source));
});
