import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { createDependencyGraph, parseResult, queryDependencies } from "@scatool/analyzer-core";

const id = "evorto+wahlzeit";
const source = join(import.meta.dirname, "repositories", id);
const commit = "7a0ae08deb62b9a9ad5d132cb5ac7d69420c9959";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const objectHash = (kind: string, bytes: Buffer) =>
  createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest();

// GitHub's pinned root tree has neither build/ nor .gradle/. Exclude only these
// two generated root directories; every other source byte/mode must match Git.
function sourceTree(directory = "", paths: string[] = []): { hash: Buffer; paths: string[] } {
  const entries = readdirSync(join(source, directory))
    .filter((name) => {
      if (directory === "" && ["build", ".gradle"].includes(name)) {
        assert.ok(lstatSync(join(source, name)).isDirectory());
        return false;
      }
      return true;
    })
    .map((name) => {
      const relative = directory ? `${directory}/${name}` : name;
      const path = join(source, relative);
      const stat = lstatSync(path);
      const mode = stat.isSymbolicLink()
        ? "120000"
        : stat.isDirectory()
          ? "40000"
          : stat.mode & 0o111
            ? "100755"
            : "100644";
      if (!stat.isDirectory()) paths.push(relative);
      const digest = stat.isDirectory()
        ? sourceTree(relative, paths).hash
        : objectHash(
            "blob",
            stat.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path),
          );
      return {
        order: name + (mode === "40000" ? "/" : ""),
        bytes: Buffer.concat([Buffer.from(`${mode} ${name}\0`), digest]),
      };
    });
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.order), Buffer.from(b.order)));
  return { hash: objectHash("tree", Buffer.concat(entries.map((entry) => entry.bytes))), paths };
}

type NativeNode = {
  id: string;
  origin: { id: string; path: string };
  isDirect: boolean;
  isProject: boolean;
  coordinates: { group: string; module: string; version: string };
  repositoryUrl: string;
  dependencies: string[];
};
type NativeConfiguration = {
  rootOrigin: { id: string; path: string };
  configurationName: string;
  scope: string;
  allDependencies: NativeNode[];
};
const configurations = [
  "classpath",
  "compileClasspath",
  "detachedConfiguration1",
  "grettyProductRuntime",
  "grettyProvidedCompile",
  "grettyRunnerJetty7",
  "grettyRunnerJetty8",
  "grettyRunnerJetty9",
  "grettyRunnerJetty93",
  "grettyRunnerJetty94",
  "grettyRunnerTomcat85",
  "grettyRunnerTomcat9",
  "grettySpringLoaded",
  "grettyStarter",
  "providedCompile",
  "providedRuntime",
  "runtimeClasspath",
  "springBoot",
  "testCompileClasspath",
  "testRuntimeClasspath",
].sort();
const duplicateConfigurations = [
  "compileClasspath",
  "grettyProductRuntime",
  "providedCompile",
  "providedRuntime",
  "runtimeClasspath",
  "springBoot",
  "testCompileClasspath",
  "testRuntimeClasspath",
].sort();
const capture = () => {
  const bytes = readFileSync(join(import.meta.dirname, "acceptance/gradle-native-wahlzeit.json"));
  assert.equal(sha256(bytes), "fac15aa6460aa44964722281691b84bb498390b08bcd07306ac07beb3f2bd6e3");
  return JSON.parse(bytes.toString()) as {
    projects: Record<string, { name: string; group: string; version: string; buildFile: string }>;
    configurations: NativeConfiguration[];
  };
};

test("Wahlzeit: pinned source tree, Gradle wrapper and native declaration inputs", () => {
  const tree = sourceTree();
  assert.equal(tree.hash.toString("hex"), "ee9695b68954860c89765e3147499894c728bdad");
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
      .filter(
        (path) =>
          inputNames.has(path.split("/").at(-1)!) ||
          /^requirements.*\.txt$/.test(path.split("/").at(-1)!),
      )
      .sort(),
    ["build.gradle"],
  );
  const hashes = {
    "build.gradle": "86331268df0a85b6d9ac699baf6dce035c819ae076fe52e40771ddf8e95db858",
    gradlew: "63135287117a1e6d12c84580f1f49c61d1ba02218ecd28660605e97f976e7d65",
    "gradlew.bat": "c46a27c79007746de5922b17abb6230d64ad8b1ba3ad1585ee5c6543c2a9b129",
    "gradle/wrapper/gradle-wrapper.jar":
      "e996d452d2645e70c01c11143ca2d3742734a28da2bf61f25c82bdc288c9e637",
    "gradle/wrapper/gradle-wrapper.properties":
      "2d549b04a9d8606708671d62234d6aa2058651b7499a361633180b323f9d79a8",
  };
  for (const [file, hash] of Object.entries(hashes))
    assert.equal(sha256(readFileSync(join(source, file))), hash);
  const build = readFileSync(join(source, "build.gradle"), "utf8");
  assert.deepEqual(
    [...build.matchAll(/\b(providedCompile|implementation|testImplementation)\s+'([^']+)'/g)].map(
      (match) => [match[1], match[2]],
    ),
    [
      ["providedCompile", "javax.servlet:javax.servlet-api:4.0.1"],
      ["implementation", "org.postgresql:postgresql:9.3-1104-jdbc41"],
      ["implementation", "log4j:log4j:1.2.17"],
      ["implementation", "com.sun.mail:javax.mail:1.6.2"],
      ["testImplementation", "junit:junit:4.12"],
    ],
  );
  assert.match(build, /id 'org.gretty' version '3\.0\.8'/);
  assert.match(build, /jcenter\(\)/);
  const native = capture();
  assert.deepEqual(native.projects, {
    ":": { name: id, group: "", version: "unspecified", buildFile: "build.gradle" },
  });
  assert.deepEqual(
    native.configurations.map((config) => config.configurationName).sort(),
    configurations,
  );
  assert.equal(
    native.configurations.reduce((count, config) => count + config.allDependencies.length, 0),
    329,
  );
  const duplicateScopes: string[] = [];
  for (const config of native.configurations) {
    const records = new Map<string, NativeNode>();
    for (const node of config.allDependencies) {
      const previous = records.get(node.id);
      if (previous) {
        assert.deepEqual(node, previous, "only identical native facts may collapse");
        assert.equal(node.id, "javax.servlet:javax.servlet-api:4.0.1");
        duplicateScopes.push(config.configurationName);
      } else records.set(node.id, node);
    }
  }
  assert.deepEqual(duplicateScopes.sort(), duplicateConfigurations);
});

test("Wahlzeit: configuration-local native identities, exact adjacency and unknown coverage", () => {
  const native = capture();
  const result = parseResult(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
  );
  assert.equal(result.codebase, `integration:evorto/wahlzeit@${commit}`);
  assert.deepEqual(result.issues, []);
  assert.equal(result.graphs.length, 20);
  assert.equal(result.packages.length, 205);
  assert.equal(result.subprojects.length, 1);
  const project = { purl: "pkg:generic/evorto%2Bwahlzeit", definitionFile: "build.gradle" };
  assert.equal(result.subprojects[0]!.purl, project.purl);
  assert.equal(result.subprojects[0]!.definitionFile, project.definitionFile);
  const observations = result.subprojects[0]!.identityObservations!;
  assert.equal(observations.length, 20);
  assert.ok(observations.every((observation) => observation.synthesizedPurl));
  const catalog = new Set<string>();
  let edgeCount = 0;
  for (const config of native.configurations) {
    const key = JSON.stringify([
      config.rootOrigin.id,
      config.rootOrigin.path,
      config.configurationName,
    ]);
    const graph = result.graphs.find((graph) => graph.source.key === key)!;
    const { id: graphId, ...observation } = graph;
    assert.deepEqual(JSON.parse(graphId), [
      "gradle",
      "build.gradle",
      createDependencyGraph(observation).id,
    ]);
    assert.ok(graph);
    assert.deepEqual(graph.source, { extractor: "gradle", files: ["build.gradle"], key });
    assert.ok(observations.some((observation) => observation.source.key === key));
    assert.equal(graph.interpretation, "resolved");
    assert.equal(graph.rootCompleteness, "unknown");
    assert.deepEqual(graph.attributes, {
      "gradle:projection": "dependency-graph-snapshot",
      "gradle:variantCoverage": "unknown",
      "gradle:rootOrigin": config.rootOrigin,
      "gradle:nativeScope": config.scope,
    });
    assert.deepEqual(graph.roots, [
      { id: "root", node: "root", project, scope: config.configurationName },
    ]);
    assert.deepEqual(
      graph.nodes.find((node) => node.id === "root"),
      { id: "root", purl: project.purl, project, dependencyCompleteness: "unknown" },
    );
    const records = new Map(config.allDependencies.map((node) => [node.id, node]));
    // The captured observation has no injected plugin record. Thus every unique
    // native dependency must survive, including Gretty/plugin-classpath packages.
    assert.ok(
      [...records.values()].every(
        (node) => node.coordinates.module !== "github-dependency-graph-gradle-plugin",
      ),
    );
    assert.equal(graph.nodes.length, records.size + 1);
    const expectedEdges: [string, string][] = [];
    for (const record of records.values()) {
      const coordinates = record.coordinates;
      assert.ok(coordinates.group && coordinates.version);
      assert.ok(
        ["https://jcenter.bintray.com", "https://plugins.gradle.org/m2"].includes(
          record.repositoryUrl,
        ),
      );
      const purl = `pkg:maven/${coordinates.group}/${coordinates.module}@${coordinates.version}?repository_url=${encodeURIComponent(record.repositoryUrl)}`;
      catalog.add(purl);
      const { dependencies, ...attributes } = record;
      assert.deepEqual(
        graph.nodes.find((node) => node.id === `node:${record.id}`),
        {
          id: `node:${record.id}`,
          purl,
          locator: record.id,
          dependencyCompleteness: "unknown",
          attributes: { "gradle:node": attributes },
        },
      );
      if (record.isDirect) expectedEdges.push(["root", `node:${record.id}`]);
      for (const target of dependencies) {
        assert.ok(records.has(target), "native target must exist in this configuration");
        expectedEdges.push([`node:${record.id}`, `node:${target}`]);
      }
    }
    assert.equal(graph.edges.length, expectedEdges.length);
    assert.deepEqual(
      graph.edges
        .map((edge) =>
          JSON.stringify([edge.from, edge.status === "resolved" ? edge.to : "unresolved"]),
        )
        .sort(),
      expectedEdges.map((edge) => JSON.stringify(edge)).sort(),
    );
    for (const edge of graph.edges) {
      assert.equal(edge.status, "resolved");
      if (edge.status !== "resolved") throw new Error("Expected native resolved target");
      assert.deepEqual(edge, {
        from: edge.from,
        to: edge.to,
        status: "resolved",
        relation: "depends-on",
        selection: "selected",
      });
    }
    edgeCount += graph.edges.length;
    const reachable = new Set<string>();
    const queue = ["root"];
    while (queue.length) {
      const from = queue.shift()!;
      for (const [owner, target] of expectedEdges) {
        if (owner === from && !reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
    const query = queryDependencies(result, { graph: graph.id, root: "root" });
    assert.deepEqual(query.definite, [...reachable].sort());
    assert.deepEqual(query.conditional, []);
    assert.deepEqual(query.declarations, []);
    assert.equal(query.completeness, "unknown");
  }
  assert.equal(edgeCount, 466);
  assert.deepEqual(result.packages.map((pkg) => pkg.purl).sort(), [...catalog].sort());
  for (const pkg of result.packages) assert.deepEqual(pkg.evidence, ["build.gradle"]);
  const direct = (scope: string) => {
    const config = native.configurations.find((config) => config.configurationName === scope)!;
    return [
      ...new Set(config.allDependencies.filter((node) => node.isDirect).map((node) => node.id)),
    ].sort();
  };
  const main = [
    "javax.servlet:javax.servlet-api:4.0.1",
    "javax.websocket:javax.websocket-api:1.0",
    "org.postgresql:postgresql:9.3-1104-jdbc41",
    "log4j:log4j:1.2.17",
    "com.sun.mail:javax.mail:1.6.2",
  ].sort();
  for (const scope of ["compileClasspath", "runtimeClasspath"])
    assert.deepEqual(direct(scope), main);
  for (const scope of ["testCompileClasspath", "testRuntimeClasspath"])
    assert.deepEqual(direct(scope), [...main, "junit:junit:4.12"].sort());
  assert.ok(!JSON.stringify(result).includes(source));
});
