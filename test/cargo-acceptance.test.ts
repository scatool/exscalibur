import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";

const cases = [
  {
    id: "BurntSushi+ripgrep",
    pin: "0a88cccd5188074de96f54a4b6b44a63971ac157",
    tree: "4906fc180038c07fb8a68171a89f6422f5cfb5e1",
    files: 220,
    locks: [
      {
        path: "Cargo.lock",
        sha256: "8aee2707b876453e57e5b89846ab5b33d429a4e0d1f5a95f7c8622db130cf59f",
        packages: 61,
        dependencies: 137,
        local: 10,
      },
      {
        path: "fuzz/Cargo.lock",
        sha256: "b6ee1b9ef968066415e092559b86212ea06150535f6463db9a6b0d4c2aa36ced",
        packages: 21,
        dependencies: 33,
        local: 2,
      },
    ],
    manifests: [
      "Cargo.toml",
      "crates/cli/Cargo.toml",
      "crates/globset/Cargo.toml",
      "crates/grep/Cargo.toml",
      "crates/ignore/Cargo.toml",
      "crates/matcher/Cargo.toml",
      "crates/pcre2/Cargo.toml",
      "crates/printer/Cargo.toml",
      "crates/regex/Cargo.toml",
      "crates/searcher/Cargo.toml",
      "fuzz/Cargo.toml",
    ],
  },
  {
    id: "alacritty+alacritty",
    pin: "08134af8533556034272a884e40c0aaf6bf6f930",
    tree: "89a7c899e31e344a56cf803f34ab8184272e787a",
    files: 337,
    locks: [
      {
        path: "Cargo.lock",
        sha256: "64fe1daf7dfcfdd94731c7c1e66233d68df72b240753876aa2250bc8d701b75e",
        packages: 292,
        dependencies: 707,
        local: 4,
      },
    ],
    manifests: [
      "Cargo.toml",
      "alacritty/Cargo.toml",
      "alacritty_config/Cargo.toml",
      "alacritty_config_derive/Cargo.toml",
      "alacritty_terminal/Cargo.toml",
    ],
  },
];
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const gitObject = (kind: string, data: Uint8Array) =>
  createHash("sha1").update(`${kind} ${data.length}\0`).update(data).digest();

/** Independent Git object reconstruction checks every source byte, executable bit and symlink. */
async function sourceTree(root: string) {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<Buffer> => {
    const entries: { order: string; data: Buffer }[] = [];
    for (const name of await readdir(join(root, directory))) {
      const relative = directory ? `${directory}/${name}` : name;
      const path = join(root, relative);
      const stat = await lstat(path);
      let mode: string, digest: Buffer;
      if (stat.isSymbolicLink()) {
        mode = "120000";
        digest = gitObject("blob", Buffer.from(await readlink(path)));
        paths.push(relative);
      } else if (stat.isDirectory()) {
        mode = "40000";
        digest = await visit(relative);
      } else {
        assert.ok(stat.isFile(), `Unexpected source entry: ${relative}`);
        mode = stat.mode & 0o111 ? "100755" : "100644";
        digest = gitObject("blob", await readFile(path));
        paths.push(relative);
      }
      entries.push({
        order: name + (mode === "40000" ? "/" : ""),
        data: Buffer.concat([Buffer.from(`${mode} ${name}\0`), digest]),
      });
    }
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)));
    return gitObject("tree", Buffer.concat(entries.map((entry) => entry.data)));
  };
  return { tree: (await visit("")).toString("hex"), paths };
}

type NativePackage = {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
  dependencies?: string[];
};
/** These three pinned locks use only this small TOML subset. Reject other syntax rather than
 * importing the production parser or silently skipping native fields. */
function nativeLock(text: string): { version: number; package: NativePackage[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  assert.equal(lines.shift(), "version = 4");
  const packages: NativePackage[] = [];
  let current: Partial<NativePackage> | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === "[[package]]") {
      current = {};
      packages.push(current as NativePackage);
      continue;
    }
    assert.ok(current);
    if (line === "dependencies = [") {
      assert.equal(current.dependencies, undefined);
      current.dependencies = [];
      while (lines[++index]?.trim() !== "]") {
        const item = lines[index]?.trim();
        assert.ok(item?.endsWith(","));
        const value: unknown = JSON.parse(item.slice(0, -1));
        assert.equal(typeof value, "string");
        current.dependencies.push(value as string);
      }
      continue;
    }
    const field = /^(name|version|source|checksum) = (".*")$/.exec(line);
    assert.ok(field, `Unreviewed Cargo syntax: ${line}`);
    const key = field[1] as "name" | "version" | "source" | "checksum";
    assert.equal(current[key], undefined);
    const value: unknown = JSON.parse(field[2]!);
    assert.equal(typeof value, "string");
    current[key] = value as string;
  }
  for (const pkg of packages) assert.ok(pkg.name && pkg.version);
  return { version: 4, package: packages };
}

// Covers the input names discovered by all 16 configured integration extractors, plus
// Cargo manifests explicitly inspected to ensure lock inventory is not promoted to projects.
const inputNames = new Set([
  "Cargo.lock",
  "Cargo.toml",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
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

for (const fixture of cases) {
  test(`${fixture.id}: complete pinned source and native Cargo lock records`, async () => {
    const root = join(import.meta.dirname, "repositories", fixture.id);
    const tree = await sourceTree(root);
    assert.equal(tree.tree, fixture.tree);
    assert.equal(tree.paths.length, fixture.files);
    const matches = tree.paths.filter((path) => {
      const name = path.split("/").at(-1)!;
      return inputNames.has(name) || /^requirements.*\.txt$/.test(name);
    });
    assert.deepEqual(
      matches.sort(),
      [...fixture.manifests, ...fixture.locks.map((lock) => lock.path)].sort(),
    );
    const result = parseResult(
      JSON.parse(
        await readFile(join(import.meta.dirname, "__snapshots__", `${fixture.id}.json`), "utf8"),
      ),
    );
    assert.equal(result.codebase, `integration:${fixture.id.replace("+", "/")}@${fixture.pin}`);
    assert.equal(result.graphs.length, fixture.locks.length);
    assert.deepEqual(result.subprojects, []);
    assert.equal(result.issues.length, fixture.locks.length);
    for (const issue of result.issues)
      assert.deepEqual(
        { code: issue.code, severity: issue.severity },
        { code: "cargo.raw_lock_projection", severity: "HINT" },
      );
    const observedPurls = new Set<string>();
    for (const lock of fixture.locks) {
      const text = await readFile(join(root, lock.path), "utf8");
      assert.equal(sha256(text), lock.sha256);
      const native = nativeLock(text);
      assert.equal(native.package.length, lock.packages);
      const graph = result.graphs.find(
        (graph) => graph.source.files.length === 1 && graph.source.files[0] === lock.path,
      )!;
      assert.ok(graph);
      assert.deepEqual(graph.source, {
        extractor: "cargolock",
        files: [lock.path],
        key: "raw-lock-records",
      });
      assert.equal(graph.interpretation, "locked");
      assert.equal(graph.rootCompleteness, "unknown");
      assert.deepEqual(graph.roots, []);
      assert.equal(graph.attributes?.["cargo:effectiveFeatureResolution"], "not-observed");
      assert.equal(graph.attributes?.["cargo:workspaceMembership"], "not-observed");
      assert.equal(graph.attributes?.["cargo:projection"], "raw-lock-records");
      assert.deepEqual(graph.attributes?.["cargo:document"], native);
      assert.equal(graph.nodes.length, lock.packages);
      assert.equal(graph.edges.length, lock.dependencies);
      assert.equal(native.package.filter((pkg) => !pkg.source).length, lock.local);
      const byNative = new Map(
        graph.nodes.map((node) => [JSON.stringify(node.attributes?.["cargo:lockPackage"]), node]),
      );
      assert.equal(byNative.size, lock.packages);
      let dependencyCount = 0;
      for (const pkg of native.package) {
        // Compare record values independent of object key insertion order.
        const node = graph.nodes.find((node) => {
          const item = node.attributes?.["cargo:lockPackage"] as NativePackage;
          return (
            item.name === pkg.name && item.version === pkg.version && item.source === pkg.source
          );
        })!;
        assert.ok(node);
        assert.deepEqual(node.attributes?.["cargo:lockPackage"], pkg);
        assert.equal(node.project, undefined);
        assert.equal(node.variant, undefined);
        assert.equal(node.dependencyCompleteness, "complete");
        assert.deepEqual(node.evidence, [lock.path]);
        observedPurls.add(node.purl);
        if (pkg.source) {
          assert.equal(pkg.source, "registry+https://github.com/rust-lang/crates.io-index");
          assert.equal(node.purl, `pkg:cargo/${pkg.name}@${pkg.version}`);
        } else {
          assert.ok(node.purl.startsWith(`pkg:generic/cargo-local/${pkg.name}-`));
          assert.ok(node.purl.endsWith(`@${pkg.version}`));
        }
        const catalog = result.packages.find((item) => item.purl === node.purl)!;
        assert.ok(catalog);
        assert.deepEqual(catalog.evidence, [lock.path]);
        assert.deepEqual(catalog.identityObservations, [
          {
            source: {
              extractor: "cargolock",
              files: [lock.path],
              key: JSON.stringify(["raw-lock-records", node.id]),
            },
            synthesizedPurl: pkg.source === undefined,
          },
        ]);
        if (pkg.checksum) {
          const artifacts = [{ evidence: [lock.path], hashes: { sha256: pkg.checksum } }];
          assert.deepEqual(node.artifacts, artifacts);
          assert.deepEqual(catalog.artifacts, artifacts);
        } else assert.equal(node.artifacts, undefined);
        const outgoing = graph.edges.filter((edge) => edge.from === node.id);
        assert.equal(outgoing.length, pkg.dependencies?.length ?? 0);
        for (const reference of pkg.dependencies ?? []) {
          const parts = reference.split(" ");
          // All references in these pinned locks have an unambiguous name or name/version.
          assert.ok(parts.length === 1 || parts.length === 2);
          const targets = native.package.filter(
            (target) =>
              target.name === parts[0] && (parts.length === 1 || target.version === parts[1]),
          );
          assert.equal(targets.length, 1, reference);
          const target = targets[0]!;
          const edge = outgoing.find(
            (edge) => edge.requested?.attributes?.["cargo:lockReference"] === reference,
          )!;
          assert.ok(edge && edge.status === "resolved");
          assert.equal(edge.selection, "selected");
          assert.equal(edge.relation, "depends-on");
          assert.equal(edge.kind, "cargo:locked-dependencies");
          assert.deepEqual(edge.requested, {
            name: parts[0],
            attributes: { "cargo:lockReference": reference },
          });
          assert.deepEqual(edge.evidence, [lock.path]);
          assert.deepEqual(
            graph.nodes.find((candidate) => candidate.id === edge.to)?.attributes?.[
              "cargo:lockPackage"
            ],
            target,
          );
          dependencyCount++;
        }
      }
      assert.equal(dependencyCount, lock.dependencies);
      // Inventory does not authorize a workspace/root query even when Cargo.toml is present.
      assert.throws(
        () => queryDependencies(result, { graph: graph.id, root: "Cargo.toml" }),
        /Unknown dependency root/,
      );
    }
    assert.deepEqual([...observedPurls].sort(), result.packages.map((pkg) => pkg.purl).sort());
  });
}
