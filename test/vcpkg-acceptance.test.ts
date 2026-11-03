import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { parse as parseToml } from "smol-toml";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";
const cases = [
  {
    id: "Corvusoft+restbed",
    owner: "Corvusoft",
    repository: "restbed",
    commit: "e1227a297ce6d4e9f78222456507b29bb8ab77e9",
    tree: "c3ad9f74a95b55a762f21c2400e7394999cb68b2",
    transport: "git",
    archiveSha256: "319e190ece8e1a55bb27d2c947ea1ae78c295dbbada422b672028c074aa56c83",
    files: ["vcpkg.json"],
    nativeSha256: "dd9708de5939073ef508e13f9d5cb07c7b708540093b92f5632b00b284d39058",
  },
  {
    id: "microsoft+terminal",
    owner: "microsoft",
    repository: "terminal",
    commit: "b4e69c68620a822407d45bfbba6ee10feebc70a3",
    tree: "661e371ea7fb5a138ace7d893d2254cc10c687de",
    transport: "git",
    archiveSha256: "327f23f42545d48cf2e6ecdbde3f6711df2a16ae95773ea4108b7d46dfd6b295",
    files: ["dep/vcpkg-overlay-ports/fmt/vcpkg.json", "vcpkg.json"],
    nativeSha256: "6f5e2a109eb8ef6072544bbb95cbedfbaf538c06a1c50d55cbce4a52585a2373",
  },
  {
    id: "rustdesk+rustdesk",
    owner: "rustdesk",
    repository: "rustdesk",
    commit: "1abc897c451c8b5bbff3792509a7fef9d12f2ce3",
    tree: "06adad5af684e0cdcba101558ade135a152901b6",
    transport: "git",
    archiveSha256: "a85cb65b7b0e32e720fa1e3e3ed566795be8d83000c63d849db6a62976c6da51",
    files: [
      "Cargo.lock",
      "Cargo.toml",
      "flutter/android/app/build.gradle",
      "flutter/android/build.gradle",
      "libs/clipboard/Cargo.toml",
      "libs/enigo/Cargo.toml",
      "libs/libxdo-sys-stub/Cargo.toml",
      "libs/portable/Cargo.lock",
      "libs/portable/Cargo.toml",
      "libs/portable/requirements.txt",
      "libs/remote_printer/Cargo.toml",
      "libs/scrap/Cargo.toml",
      "libs/virtual_display/Cargo.lock",
      "libs/virtual_display/Cargo.toml",
      "libs/virtual_display/dylib/Cargo.toml",
      "res/vcpkg/aom/vcpkg.json",
      "res/vcpkg/ffmpeg/vcpkg.json",
      "res/vcpkg/libvpx/vcpkg.json",
      "res/vcpkg/libyuv/vcpkg.json",
      "res/vcpkg/mfx-dispatch/vcpkg.json",
      "res/vcpkg/opus/vcpkg.json",
      "vcpkg.json",
    ],
    nativeSha256: "6eb4ecf7fa9dee23cf1516d00a821b32ac1f4807f37de442d7f4e297fb7dc91c",
  },
];
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
const json = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const obj = (kind: string, content: Buffer) =>
  createHash("sha1").update(`${kind} ${content.length}\0`).update(content).digest();
function tree(root: string, gitlinks: Record<string, string> = {}) {
  const paths: string[] = [];
  const visit = (directory: string): Buffer => {
    const entries = readdirSync(join(root, directory)).map((name) => {
      const relative = directory ? `${directory}/${name}` : name;
      const path = join(root, relative),
        stat = lstatSync(path);
      const mode = gitlinks[relative]
        ? "160000"
        : stat.isSymbolicLink()
          ? "120000"
          : stat.isDirectory()
            ? "40000"
            : stat.mode & 0o111
              ? "100755"
              : "100644";
      if (mode !== "40000" && mode !== "160000") paths.push(relative);
      const digest =
        mode === "160000"
          ? Buffer.from(gitlinks[relative]!, "hex")
          : mode === "40000"
            ? visit(relative)
            : obj("blob", mode === "120000" ? Buffer.from(readlinkSync(path)) : readFileSync(path));
      return {
        order: name + (mode === "40000" ? "/" : ""),
        data: Buffer.concat([Buffer.from(`${mode} ${name}\0`), digest]),
      };
    });
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)));
    return obj("tree", Buffer.concat(entries.map((entry) => entry.data)));
  };
  return { tree: visit("").toString("hex"), paths };
}

const sorted = (items: unknown[]) => items.map((x) => JSON.stringify(x)).sort();
const declarations = (port: any) => [
  ...(port.dependencies ?? []).map((dep: any) => ({ dep })),
  ...Object.entries(port.features ?? {}).flatMap(([feature, value]: [string, any]) =>
    (value.dependencies ?? []).map((dep: any) => ({
      dep,
      feature,
      featureSupports: value.supports,
    })),
  ),
];
for (const fixture of cases)
  test(`${fixture.id}: pinned sources, native registry declarations and auxiliary inputs`, () => {
    const source = join(import.meta.dirname, "repositories", fixture.id);
    const full = tree(
      source,
      fixture.id === "rustdesk+rustdesk"
        ? { "libs/hbb_common": "48c37de3e6c4e399af6f51ca20e8e3e1fd037976" }
        : {},
    );
    assert.equal(full.tree, fixture.tree);
    assert.deepEqual(
      full.paths
        .filter(
          (path) =>
            inputNames.has(path.split("/").at(-1)!) ||
            /^requirements.*\.txt$/.test(path.split("/").at(-1)!),
        )
        .sort(),
      fixture.files,
    );
    const nativeBytes = readFileSync(
      join(import.meta.dirname, "acceptance", `vcpkg-native-${fixture.id}.json`),
    );
    assert.equal(createHash("sha256").update(nativeBytes).digest("hex"), fixture.nativeSha256);
    const native = JSON.parse(nativeBytes.toString());
    assert.equal(native.toolCommit, "56bb2411609227288b70117ead2c47585ba07713");
    const result = parseResult(
      json(join(import.meta.dirname, "__snapshots__", `${fixture.id}.json`)),
    );
    assert.equal(
      result.codebase,
      `integration:${fixture.owner}/${fixture.repository}@${fixture.commit}`,
    );
    assert.deepEqual(
      sorted(result.issues.map((x) => [x.code, x.severity, x.file])),
      fixture.id === "rustdesk+rustdesk"
        ? sorted(
            fixture.files
              .filter((f) => f.endsWith("Cargo.lock"))
              .map((f) => ["cargo.raw_lock_projection", "HINT", f]),
          )
        : [],
    );
    assert.deepEqual(
      native.views.map((v: any) => v.file).sort(),
      fixture.files.filter((f) => f.endsWith("vcpkg.json")),
    );
    const graphs = result.graphs.filter((g) => g.source.extractor === "vcpkg");
    assert.deepEqual(
      graphs.map((g) => g.source.files[0]).sort(),
      fixture.files.filter((f) => f.endsWith("vcpkg.json")),
    );
    for (const view of native.views) {
      const graph = graphs.find((g) => g.source.files[0] === view.file)!;
      assert.ok(graph);
      const manifest = json(join(source, view.file));
      assert.equal(graph.interpretation, "declared");
      assert.equal(graph.rootCompleteness, "complete");
      assert.deepEqual(graph.roots.map((r) => r.scope).sort(), ["host", "target"]);
      assert.deepEqual(graph.attributes, {
        "vcpkg:projection": "registry-declarations",
        "vcpkg:resolution": "unobserved",
      });
      assert.deepEqual(graph.context, { "vcpkg:includeAllFeatures": false });
      assert.equal(graph.nodes.length, 2 * (Object.keys(view.ports).length + 1));
      const expected: any[] = [];
      for (const node of graph.nodes) {
        const [name, domain] = JSON.parse(node.id);
        const port = name === "[root]" ? manifest : view.ports[name];
        assert.ok(port);
        assert.deepEqual(node.attributes, { "vcpkg:domain": domain, "vcpkg:manifest": port });
        assert.equal(node.dependencyCompleteness, "complete");
        assert.equal(node.variant, undefined);
        assert.deepEqual(node.evidence, [view.file]);
        if (name !== "[root]") {
          const version =
            port.version ??
            port["version-date"] ??
            port["version-semver"] ??
            port["version-string"];
          assert.equal(
            node.purl,
            `pkg:vcpkg/${port.name ?? name}${version ? "@" + version : ""}${port["port-version"] !== undefined ? "?port_version=" + port["port-version"] : ""}`,
          );
        } else {
          assert.equal(node.project?.definitionFile, view.file);
          const rootName =
            manifest.name ?? (view.file === "vcpkg.json" ? "project" : view.file.split("/").at(-2));
          const rootVersion =
            manifest.version ??
            manifest["version-date"] ??
            manifest["version-semver"] ??
            manifest["version-string"];
          assert.equal(
            node.purl,
            `pkg:vcpkg/${rootName}${rootVersion ? "@" + rootVersion : ""}${manifest["port-version"] !== undefined ? "?port_version=" + manifest["port-version"] : ""}`,
          );
          assert.ok(graph.roots.some((r) => r.node === node.id && r.scope === domain));
        }
        for (const record of declarations(port)) {
          const dep = typeof record.dep === "string" ? { name: record.dep } : record.dep;
          if (name === "[root]" && Boolean(dep.host) !== (domain === "host")) continue;
          const expression: any = {};
          if (dep.platform) expression.platform = dep.platform;
          if (record.feature) expression.feature = record.feature;
          if (record.featureSupports) expression.featureSupports = record.featureSupports;
          if (port.supports) expression.supports = port.supports;
          const condition = Object.keys(expression).length
            ? { language: "vcpkg:declaration", environment: domain, expression }
            : undefined;
          const target = view.ports[dep.name]
            ? JSON.stringify([dep.name, dep.host || domain === "host" ? "host" : "target"])
            : undefined;
          expected.push({
            from: node.id,
            to: target,
            status: target ? "resolved" : "unresolved",
            selection: "unknown",
            relation: "depends-on",
            kind: dep.host ? "host" : "target",
            condition,
            requested: {
              name: dep.name,
              ...(dep["version>="] ? { specifier: `>=${dep["version>="]}` } : {}),
              ...(condition ? { condition } : {}),
              ...(dep.features
                ? { features: dep.features.filter((f: any) => typeof f === "string") }
                : {}),
              attributes: { "vcpkg:request": record.dep },
            },
            evidence: [view.file],
            ...(target ? { attributes: { "vcpkg:binding": "registry-candidate" } } : {}),
          });
        }
      }
      // Compare field values without relying on object insertion order.
      const canonical = (value: any): any =>
        Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .filter((k) => value[k] !== undefined)
                  .map((k) => [k, canonical(value[k])]),
              )
            : value;
      assert.deepEqual(sorted(graph.edges.map(canonical)), sorted(expected.map(canonical)));
      assert.ok(
        native.views.every((v: any) =>
          v.commands.every((c: any) => c.exitCode === 1 && c.args[0] === "x-package-info"),
        ),
      );
    }
    // Query the small independent overlay graph; unknown candidate selection cannot
    // become definite membership even though its declaration adjacency is complete.
    for (const graph of graphs.filter((g) => g.nodes.length <= 6))
      for (const root of graph.roots) {
        const closure = queryDependencies(result, { graph: graph.id, root: root.id });
        assert.deepEqual(closure.definite, []);
        assert.equal(closure.completeness, closure.conditional.length ? "partial" : "complete");
      }
    const cargo = result.graphs.filter((g) => g.source.extractor === "cargolock");
    assert.deepEqual(
      cargo.map((g) => g.source.files[0]).sort(),
      fixture.files.filter((f) => f.endsWith("Cargo.lock")),
    );
    for (const graph of cargo) {
      const file = graph.source.files[0]!;
      const document = parseToml(readFileSync(join(source, file), "utf8")) as any;
      const records = document.package as any[];
      assert.deepEqual(graph.attributes?.["cargo:document"], document);
      assert.equal(graph.nodes.length, records.length);
      assert.deepEqual(graph.roots, []);
      assert.equal(graph.rootCompleteness, "unknown");
      assert.equal(graph.interpretation, "locked");
      const find = (r: any) =>
        graph.nodes.find((n) => {
          const p = n.attributes?.["cargo:lockPackage"] as any;
          return p.name === r.name && p.version === r.version && p.source === r.source;
        })!;
      let count = 0;
      for (const record of records) {
        const node = find(record);
        assert.ok(node);
        assert.deepEqual(node.attributes?.["cargo:lockPackage"], record);
        assert.equal(node.project, undefined);
        const base = `pkg:cargo/${record.name}@${record.version}`;
        if (record.source)
          assert.equal(
            node.purl,
            base +
              (record.source === "registry+https://github.com/rust-lang/crates.io-index" ||
              record.source === "sparse+https://index.crates.io/"
                ? ""
                : "?cargo_source=" + encodeURIComponent(record.source)),
          );
        else {
          const digest = createHash("sha256")
            .update(
              JSON.stringify([
                result.codebase,
                file,
                JSON.stringify([record.name, record.version, null]),
              ]),
            )
            .digest("hex");
          assert.equal(
            node.purl,
            `pkg:generic/cargo-local/${record.name}-${digest}@${record.version}`,
          );
        }
        if (record.checksum)
          assert.deepEqual(node.artifacts, [
            { evidence: [file], hashes: { sha256: record.checksum } },
          ]);
        else assert.equal(node.artifacts, undefined);

        assert.equal(node.dependencyCompleteness, "complete");
        const edges = graph.edges.filter((e) => e.from === node.id);
        assert.equal(edges.length, (record.dependencies ?? []).length);
        for (const ref of record.dependencies ?? []) {
          count++;
          const match = /^(\S+)(?: (\S+))?(?: \((.+)\))?$/.exec(ref)!;
          assert.ok(match);
          const candidates = records.filter(
            (r) =>
              r.name === match[1] &&
              (!match[2] || r.version === match[2]) &&
              (!match[3] || r.source === match[3]),
          );
          assert.equal(candidates.length, 1);
          const edge = edges.find((e) => e.requested?.attributes?.["cargo:lockReference"] === ref)!;
          assert.ok(edge);
          assert.deepEqual(edge.requested, {
            name: match[1],
            attributes: { "cargo:lockReference": ref },
          });
          assert.equal(edge.to, find(candidates[0]).id);
          assert.equal(edge.selection, "selected");
          assert.equal(edge.status, "resolved");
        }
      }
      assert.equal(graph.edges.length, count);
    }
    const requirements = result.graphs.filter((g) => g.source.extractor === "requirementstxt");
    if (fixture.id === "rustdesk+rustdesk") {
      assert.equal(requirements.length, 1);
      const graph = requirements[0]!;
      assert.equal(
        readFileSync(join(source, "libs/portable/requirements.txt"), "utf8").trim(),
        "brotli",
      );
      assert.equal(graph.edges.length, 1);
      assert.equal(graph.edges[0]!.requested?.name, "brotli");
      assert.equal(graph.edges[0]!.status, "declared");
      assert.equal(graph.edges[0]!.to, undefined);
      assert.equal(graph.nodes[0]!.dependencyCompleteness, "complete");
    } else assert.equal(requirements.length, 0);
    assert.equal(result.graphs.length, graphs.length + cargo.length + requirements.length);
    assert.deepEqual(
      [
        ...new Set(
          result.graphs.flatMap((g) => g.nodes.filter((n) => !n.project).map((n) => n.purl)),
        ),
      ].sort(),
      result.packages.map((p) => p.purl).sort(),
    );
  });
