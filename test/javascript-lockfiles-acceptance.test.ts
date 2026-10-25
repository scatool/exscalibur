import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { join, dirname, normalize } from "node:path/posix";
import { test } from "vite-plus/test";
import {
  parseResult,
  queryDependencies,
  type DependencyGraph,
  type DependencyView,
} from "@scatool/analyzer-core";
import { checkYarnBindingUncertainty } from "./yarn-binding-acceptance.ts";

const cases = [
  {
    id: "keithamus+sort-package-json",
    pin: "a03895650fb6fe155af6c2c03491de9bc492fdab",
    tree: "26e78b87a851b35d7f1ee4081235c0e9750cc737",
    fileCount: 43,
    files: ["package-lock.json", "package.json"],
    issues: [["npm.manifest_lock_mismatch", "WARNING", "package.json"]],
  },
  {
    id: "linear+linear",
    pin: "5a308978229da2aa092177055446669af657c034",
    tree: "4b9464470966f49e07daef55f040772a632079f0",
    fileCount: 174,
    files: [
      "examples/nextjs-file-upload/package.json",
      "examples/nextjs-file-upload/yarn.lock",
      "package.json",
      "packages/codegen-doc/package.json",
      "packages/codegen-sdk/package.json",
      "packages/codegen-test/package.json",
      "packages/import/package.json",
      "packages/sdk/package.json",
      "packages/sdk/webhooks/package.json",
      "yarn.lock",
    ],
    issues: [
      ["yarn.raw_lock_projection", "HINT", "examples/nextjs-file-upload/yarn.lock"],
      ["yarn.raw_lock_projection", "HINT", "yarn.lock"],
    ],
  },
  {
    id: "lint-staged+lint-staged",
    pin: "a1ec97295c6163acb2e8fe1adeae9fbe14de16a2",
    tree: "561b8993844d93a643b7ec5e73c6a3999684e059",
    fileCount: 158,
    files: [
      "package-lock.json",
      "package.json",
      "test/unit/__mocks__/my-lint-staged-config/package.json",
    ],
    issues: [],
  },
  {
    id: "riehlegroup+mini-meco",
    pin: "9c6c42bc83c4adf50213d1b8e58ba6afe98c1b75",
    tree: "b2c9c2a8ef37fff462e057b77f1f33f4328477d7",
    fileCount: 189,
    files: [
      "client/package.json",
      "package-lock.json",
      "package.json",
      "server/package-lock.json",
      "server/package.json",
    ],
    issues: [],
  },
  {
    id: "riehlegroup+msadoc",
    pin: "7cc6b2f1f5c597d733a8a7bdb77905a16047e06c",
    tree: "252f1d34eaad63a46f010b12e46027ee341e78ce",
    fileCount: 268,
    files: [
      "cli/package.json",
      "client-generated/package.json",
      "client-generator/package.json",
      "frontend/package.json",
      "package-lock.json",
      "package.json",
      "server/package.json",
    ],
    issues: [["npm.manifest_lock_mismatch", "WARNING", "package.json"]],
  },
  {
    id: "sindresorhus+execa",
    pin: "23ec6f0569b3e42af43294dc807494ebe896e980",
    tree: "525e090234773547838e06140812cade695ea3b1",
    fileCount: 624,
    files: ["package.json"],
    issues: [],
  },
  {
    id: "sindresorhus+got",
    pin: "f9faa7a40599001636c3ae2a68e875e3419e5084",
    tree: "919456a4776ecc792c19b063968e99eb2cb1e781",
    fileCount: 117,
    files: ["package.json"],
    issues: [],
  },
  {
    id: "svg+svgo",
    pin: "9d9afa35bb1eadd09302ddafdc7a28683bfa67c7",
    tree: "44ba78ac68bbaf3543d52f2228b98c48a90c7d29",
    fileCount: 589,
    files: ["package.json", "yarn.lock"],
    issues: [
      ["npm.unresolved_dependency", "WARNING", "package.json"],
      ["yarn.raw_lock_projection", "HINT", "yarn.lock"],
    ],
  },
  {
    id: "terser+html-minifier-terser",
    pin: "c4a7ae0bd08b1a438d9ca12a229b4cbe93fc016a",
    tree: "8f445e32b6a665f464d3392c407c36bbf101602e",
    fileCount: 39,
    files: [
      "benchmarks/package-lock.json",
      "benchmarks/package.json",
      "package-lock.json",
      "package.json",
    ],
    issues: [],
  },
  {
    id: "webpack-contrib+webpack-bundle-analyzer",
    pin: "8755634841119cedd3efa315a2224d13b6ef51f5",
    tree: "18c5c8967a569db433e2f6af125e7d245ae91916",
    fileCount: 194,
    files: [
      "package-lock.json",
      "package.json",
      "test/webpack-versions/4.44.2/package-lock.json",
      "test/webpack-versions/4.44.2/package.json",
      "test/webpack-versions/5.76.0/package-lock.json",
      "test/webpack-versions/5.76.0/package.json",
    ],
    issues: [
      ["npm.manifest_lock_mismatch", "WARNING", "test/webpack-versions/4.44.2/package.json"],
      ["npm.manifest_lock_mismatch", "WARNING", "test/webpack-versions/5.76.0/package.json"],
    ],
  },
];

type Native = Record<string, any>;
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const sort = <T>(values: T[]) =>
  values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const nativeRequire = createRequire(
  new URL("../packages/analyzer-plugin-javascript/package.json", import.meta.url),
);
const parseYaml = nativeRequire("yaml").parse as (text: string, options: Native) => Native;
const parseClassic = nativeRequire("@yarnpkg/lockfile").parse as (text: string) => {
  type: string;
  object: Native;
};
const satisfies = nativeRequire("semver").satisfies as (version: string, range: string) => boolean;
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
const json = (path: string): Native => JSON.parse(readFileSync(path, "utf8"));
const obj = (kind: string, content: Buffer) =>
  createHash("sha1").update(`${kind} ${content.length}\0`).update(content).digest();
function tree(root: string) {
  const paths: string[] = [];
  const visit = (directory: string): Buffer => {
    const entries = readdirSync(join(root, directory)).map((name) => {
      const relative = directory ? `${directory}/${name}` : name;
      const path = join(root, relative),
        stat = lstatSync(path);
      const mode = stat.isSymbolicLink()
        ? "120000"
        : stat.isDirectory()
          ? "40000"
          : stat.mode & 0o111
            ? "100755"
            : "100644";
      if (mode !== "40000") paths.push(relative);
      const digest =
        mode === "40000"
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
function requestTuples(record: Native, onlyScope?: string) {
  return scopes
    .filter((scope) => onlyScope === undefined || onlyScope === scope)
    .flatMap((scope) =>
      Object.entries(record[scope] ?? {}).map(([name, specifier]) => ({
        scope,
        name,
        specifier,
        optional:
          scope === "optionalDependencies" ||
          (scope === "peerDependencies" && record.peerDependenciesMeta?.[name]?.optional === true),
        shadowed:
          scope === "dependencies" && Object.hasOwn(record.optionalDependencies ?? {}, name),
      })),
    );
}
const platform = (record: Native) =>
  Object.fromEntries(
    ["os", "cpu", "libc"].filter((key) => key in record).map((key) => [key, record[key]]),
  );
const npmPurl = (name: string, version?: string) =>
  `pkg:npm/${name.toLowerCase().replace(/^@/, "%40")}${version ? `@${version}` : ""}`;

function assertDeclared(graph: DependencyGraph, root: string) {
  assert.equal(graph.interpretation, "declared");
  assert.equal(graph.rootCompleteness, "complete");
  const definitions = [...new Set(graph.roots.map((entry) => entry.project.definitionFile))];
  assert.equal(graph.nodes.length, definitions.length * 5);
  let count = 0;
  for (const file of definitions) {
    const manifest = json(join(root, file));
    const roots = graph.roots.filter((entry) => entry.project.definitionFile === file);
    assert.deepEqual(sort(roots.map((entry) => entry.scope)), sort([...scopes]));
    for (const entry of roots) {
      if (manifest.name) assert.equal(entry.project.purl, npmPurl(manifest.name, manifest.version));
      const edges = graph.edges.filter((edge) => edge.from === entry.node);
      const requested = requestTuples(manifest, entry.scope);
      assert.deepEqual(
        sort(edges.map((edge) => [edge.kind, edge.requested?.name, edge.requested?.specifier])),
        sort(requested.map((item) => [item.scope, item.name, item.specifier])),
      );
      for (const edge of edges) {
        const request = requested.find((item) => item.name === edge.requested?.name)!;
        assert.equal(edge.status, "declared");
        assert.equal(edge.selection, request.shadowed ? "excluded" : "selected");
        assert.equal(edge.optional, request.optional);
        assert.equal(edge.to, undefined);
        assert.equal(edge.condition, undefined);
        assert.deepEqual(edge.evidence, [file]);
      }
      const node = graph.nodes.find((node) => node.id === entry.node)!;
      assert.equal(node.dependencyCompleteness, "complete");
      count += requested.length;
    }
    const consumer = graph.nodes.find(
      (node) => node.project?.definitionFile === file && node.locator !== undefined,
    )!;
    assert.equal(consumer.dependencyCompleteness, "unknown");
    assert.equal(graph.edges.filter((edge) => edge.from === consumer.id).length, 0);
  }
  assert.equal(graph.edges.length, count);
}

function assertNpm(graph: DependencyGraph, root: string) {
  const lockFile = graph.source.files.find((file) =>
    /(?:package-lock|npm-shrinkwrap)\.json$/.test(file),
  )!;
  const lock = json(join(root, lockFile));
  assert.ok(lock.lockfileVersion === 2 || lock.lockfileVersion === 3);
  const records = lock.packages as Record<string, Native>;
  assert.equal(graph.attributes?.["npm:lockfileVersion"], lock.lockfileVersion);
  assert.equal(graph.rootCompleteness, "complete");
  const packageLocations = Object.keys(records).filter(
    (location) => location.split("/").includes("node_modules") && !records[location]!.link,
  );
  assert.deepEqual(
    sort(graph.nodes.filter((node) => !node.project).map((node) => node.locator)),
    sort(packageLocations),
  );
  const byLocation = new Map(
    graph.nodes.filter((node) => node.locator !== undefined).map((node) => [node.locator!, node]),
  );
  const workspaceLocations = Object.keys(records).filter(
    (location) => !location.split("/").includes("node_modules"),
  );
  assert.equal(graph.nodes.length, packageLocations.length + workspaceLocations.length * 5);
  assert.equal(graph.roots.length, workspaceLocations.length * 4);
  for (const location of workspaceLocations) {
    const file = join(dirname(lockFile), location, "package.json");
    const roots = graph.roots.filter((entry) => entry.project.definitionFile === file);
    assert.equal(roots.length, 4);
    assert.deepEqual(sort(roots.map((entry) => entry.scope)), sort([...scopes]));
    assert.equal(byLocation.get(location)!.project!.definitionFile, file);
  }
  // Independent nearest-ancestor placement lookup; links resolve at the lockfile root.
  const lookup = (location: string, name: string): DependencyView | undefined => {
    const parts = location.split("/").filter(Boolean);
    for (let length = parts.length; length >= 0; length--) {
      const ancestors = parts.slice(0, length);
      if (ancestors.at(-1) === "node_modules") continue;
      let candidate = [...ancestors, "node_modules", name].join("/");
      if (!(candidate in records)) continue;
      const seen = new Set<string>();
      while (records[candidate]?.link) {
        assert.ok(!seen.has(candidate));
        seen.add(candidate);
        candidate = normalize(records[candidate]!.resolved.replace(/^file:/, ""));
        if (candidate === ".") candidate = "";
      }
      return byLocation.get(candidate);
    }
    return undefined;
  };
  let count = 0;
  for (const node of graph.nodes) {
    const scopeRoot = graph.roots.find((entry) => entry.node === node.id);
    const location = scopeRoot
      ? graph.nodes.find(
          (view) =>
            view.project?.definitionFile === scopeRoot.project.definitionFile &&
            view.locator !== undefined,
        )!.locator!
      : node.locator!;
    const metadata = records[location]!;
    assert.ok(metadata);
    assert.equal(node.dependencyCompleteness, "complete");
    if (!node.project) {
      assert.deepEqual(node.attributes?.["npm:metadata"], metadata);
      const name = metadata.name ?? location.split("node_modules/").at(-1)!;
      assert.equal(node.purl, npmPurl(name, metadata.version));
      const facts = platform(metadata);
      assert.deepEqual(
        node.attributes?.["npm:platform"],
        Object.keys(facts).length ? facts : undefined,
      );
      if (metadata.resolved || metadata.integrity)
        assert.deepEqual(node.artifacts, [
          {
            ...(metadata.resolved && { location: metadata.resolved }),
            ...(metadata.integrity && { attributes: { "npm:integrity": metadata.integrity } }),
            evidence: [lockFile],
          },
        ]);
    }
    const requests = requestTuples(metadata, scopeRoot?.scope);
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    assert.deepEqual(
      sort(edges.map((edge) => [edge.kind, edge.requested?.name, edge.requested?.specifier])),
      sort(requests.map((item) => [item.scope, item.name, item.specifier])),
    );
    for (const request of requests) {
      const edge = edges.find(
        (edge) => edge.kind === request.scope && edge.requested?.name === request.name,
      )!;
      const target = lookup(location, request.name);
      const excluded: boolean =
        request.shadowed || (!scopeRoot && request.scope === "devDependencies");
      const peer = request.scope === "peerDependencies";
      const optionalMissing = request.optional && !target;
      const selection =
        excluded || (peer && optionalMissing)
          ? "excluded"
          : peer || optionalMissing
            ? "unknown"
            : "selected";
      assert.equal(edge.optional, request.optional);
      assert.equal(edge.relation, "depends-on");
      assert.equal(
        edge.status,
        target ? "resolved" : peer || excluded || optionalMissing ? "declared" : "unresolved",
      );
      assert.equal(edge.to, target?.id);
      const targetPlatform = target?.attributes?.["npm:platform"];
      assert.equal(
        edge.selection,
        targetPlatform && selection !== "excluded" && selection !== "unknown"
          ? "conditional"
          : selection,
      );
      if (targetPlatform && selection !== "excluded")
        assert.deepEqual(edge.condition, {
          language: "npm:platform/v1",
          expression: targetPlatform,
        });
      else assert.equal(edge.condition, undefined);
    }
    count += requests.length;
  }
  assert.equal(graph.edges.length, count);
}

type YarnRecord = { record: Native; descriptors: string[]; locator: string };
function yarnRecords(text: string): { modern: boolean; records: YarnRecord[] } {
  if (/^__metadata:/m.test(text)) {
    const document = parseYaml(text, { schema: "failsafe" });
    const byLocator = new Map<string, YarnRecord>();
    for (const [key, record] of Object.entries(document) as [string, Native][]) {
      if (key === "__metadata") continue;
      const previous = byLocator.get(record.resolution);
      if (previous) {
        assert.deepEqual(previous.record, record);
        previous.descriptors.push(...key.split(/,\s*/));
      } else
        byLocator.set(record.resolution, {
          record,
          descriptors: key.split(/,\s*/),
          locator: record.resolution,
        });
    }
    return { modern: true, records: [...byLocator.values()] };
  }
  const parsed = parseClassic(text);
  assert.equal(parsed.type, "success");
  const groups = new Map<Native, string[]>();
  for (const [descriptor, record] of Object.entries(parsed.object) as [string, Native][])
    groups.set(record, [...(groups.get(record) ?? []), descriptor]);
  return {
    modern: false,
    records: [...groups].map(([record, descriptors]) => ({
      record,
      descriptors,
      locator: [...descriptors].sort().join(", "),
    })),
  };
}
function assertYarn(graph: DependencyGraph, root: string) {
  const file = graph.source.files.find((path) => path.endsWith("yarn.lock"))!;
  const { modern, records } = yarnRecords(readFileSync(join(root, file), "utf8"));
  const scoped = graph.attributes?.["yarn:observation"] === "current-manifest-scopes";
  assert.equal(graph.attributes?.["yarn:projection"], "raw-descriptor-map");
  assert.equal(graph.attributes?.["yarn:effectiveResolution"], "not-observed");
  assert.equal(graph.attributes?.["yarn:resolverTransformations"], "not-applied");
  assert.equal(graph.attributes?.["yarn:peerBindings"], "not-recorded-in-lockfile");
  const nativeNodes = graph.nodes.filter((node) => node.attributes?.["yarn:record"]);
  assert.equal(nativeNodes.length, records.length);
  const byDescriptor = new Map<string, YarnRecord>();
  for (const entry of records)
    for (const descriptor of entry.descriptors) byDescriptor.set(descriptor, entry);
  const uncertainNodes = checkYarnBindingUncertainty(
    graph,
    (path) => readFileSync(join(root, path), "utf8"),
    byDescriptor.keys(),
  );
  const byLocator = new Map(
    graph.nodes.filter((node) => node.locator !== undefined).map((node) => [node.locator!, node]),
  );
  const binding = (name: string, specifier: string) => {
    if (scoped && !modern) {
      const local = graph.nodes
        .filter((node) => node.project && node.locator !== undefined)
        .filter((node) => {
          const manifest = json(join(root, node.project!.definitionFile));
          return (
            manifest.name === name && manifest.version && satisfies(manifest.version, specifier)
          );
        });
      assert.ok(local.length <= 1);
      if (local.length) return local[0];
    }
    const record =
      byDescriptor.get(`${name}@${specifier}`) ??
      (modern ? byDescriptor.get(`${name}@npm:${specifier}`) : undefined);
    return record ? byLocator.get(record.locator) : undefined;
  };
  let count = 0;
  for (const node of graph.nodes) {
    const scopeRoot = graph.roots.find((entry) => entry.node === node.id);
    let metadata: Native;
    let scopesToRead: string[];
    let lockRecord: boolean;
    if (node.project && scoped) {
      metadata = json(join(root, node.project.definitionFile));
      scopesToRead = scopeRoot ? [scopeRoot.scope] : scopes;
      lockRecord = false;
    } else {
      const native = scopeRoot
        ? graph.nodes.find(
            (view) =>
              view.project?.definitionFile === scopeRoot.project.definitionFile &&
              view.attributes?.["yarn:record"],
          )!
        : node;
      const entry = records.find((entry) => entry.locator === native.locator)!;
      assert.ok(entry);
      metadata = JSON.parse(JSON.stringify(entry.record));
      assert.deepEqual(native.attributes?.["yarn:record"], metadata);
      assert.deepEqual(
        sort(native.attributes?.["yarn:descriptors"] as string[]),
        sort([...entry.descriptors]),
      );
      if (!node.project) {
        assert.equal(
          node.dependencyCompleteness,
          uncertainNodes.has(node.id) ? "unknown" : modern ? "complete" : "unknown",
        );
        const splitDescriptor = (value: string) => {
          const separator = value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0);
          assert.ok(separator > 0);
          return [value.slice(0, separator), value.slice(separator + 1)];
        };
        let [name, reference] = splitDescriptor(modern ? entry.locator : entry.descriptors[0]!);
        if (!modern && reference!.startsWith("npm:")) [name] = splitDescriptor(reference!.slice(4));
        assert.equal(
          node.purl,
          npmPurl(name!, metadata.version === "0.0.0-use.local" ? undefined : metadata.version),
        );
        const expectedEvidence = [file];
        if (
          graph.edges.some(
            (edge) =>
              edge.from === node.id &&
              (edge.attributes?.["yarn:bindingUncertainty"] as Native | undefined)?.reason ===
                "unapplied-resolution",
          )
        )
          expectedEvidence.push(join(dirname(file), "package.json"));
        assert.deepEqual(sort(node.evidence ?? []), sort(expectedEvidence));
        if (metadata.resolved || metadata.integrity)
          assert.deepEqual(node.artifacts, [
            {
              ...(metadata.resolved && { location: metadata.resolved }),
              ...(metadata.integrity && { attributes: { "npm:integrity": metadata.integrity } }),
              evidence: [file],
            },
          ]);
      }
      scopesToRead = ["dependencies", "optionalDependencies", "peerDependencies"];
      lockRecord = true;
    }
    const requests = scopesToRead.flatMap((scope) =>
      Object.entries(metadata[scope] ?? {}).map(([name, specifier]) => ({
        scope,
        name,
        specifier: String(specifier),
      })),
    );
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    const kind = (scope: string) =>
      lockRecord && node.project && scope !== "peerDependencies" ? "yarn:dependencies" : scope;
    assert.deepEqual(
      sort(edges.map((edge) => [edge.kind, edge.requested?.name, edge.requested?.specifier])),
      sort(requests.map((request) => [kind(request.scope), request.name, request.specifier])),
    );
    for (const request of requests) {
      const edge = edges.find(
        (edge) => edge.kind === kind(request.scope) && edge.requested?.name === request.name,
      )!;
      const peer = request.scope === "peerDependencies";
      const target = peer ? undefined : binding(request.name, request.specifier);
      assert.equal(edge.to, target?.id);
      assert.equal(edge.relation, "depends-on");
      const optional =
        request.scope === "optionalDependencies" ||
        (peer
          ? [true, "true"].includes(metadata.peerDependenciesMeta?.[request.name]?.optional)
          : [true, "true"].includes(metadata.dependenciesMeta?.[request.name]?.optional));
      assert.equal(edge.optional, optional);
      const shadowed =
        request.scope === "dependencies" &&
        Object.hasOwn(metadata.optionalDependencies ?? {}, request.name);
      const excluded: boolean =
        !lockRecord && (shadowed || (!scopeRoot && request.scope === "devDependencies"));
      let selection: string = lockRecord
        ? peer || (optional && !target)
          ? "unknown"
          : "selected"
        : !modern
          ? "unknown"
          : "selected";
      if (excluded) selection = "excluded";
      if (edge.attributes?.["yarn:bindingUncertainty"] !== undefined) selection = "unknown";
      const nativeTarget = target?.attributes?.["yarn:record"] as Native | undefined;
      const targetPlatform = nativeTarget ? platform(nativeTarget) : {};
      const expectedCondition =
        nativeTarget?.conditions !== undefined
          ? {
              language: "yarn:applicability/v1",
              expression: {
                conditions: nativeTarget.conditions,
                ...(Object.keys(targetPlatform).length ? { platform: targetPlatform } : {}),
              },
            }
          : Object.keys(targetPlatform).length
            ? { language: "npm:platform/v1", expression: targetPlatform }
            : undefined;
      assert.deepEqual(edge.condition, excluded ? undefined : expectedCondition);
      const conditional: boolean = expectedCondition !== undefined && !excluded;
      assert.equal(
        edge.selection,
        selection === "selected" && conditional ? "conditional" : selection,
      );
      assert.equal(
        edge.status,
        target ? "resolved" : !lockRecord || peer || optional ? "declared" : "unresolved",
      );
      if (peer) assert.equal(edge.to, undefined);
    }
    count += requests.length;
  }
  assert.equal(graph.edges.length, count);
  if (!modern && !scoped) {
    assert.equal(graph.rootCompleteness, "unknown");
    assert.deepEqual(graph.roots, []);
  }
  if (scoped) {
    for (const definition of new Set(graph.roots.map((entry) => entry.project.definitionFile)))
      assert.deepEqual(
        sort(
          graph.roots
            .filter((entry) => entry.project.definitionFile === definition)
            .map((entry) => entry.scope),
        ),
        sort([...scopes]),
      );
  }
}

for (const fixture of cases) {
  test(`${fixture.id}: complete source and every native declaration/binding`, () => {
    const source = join(import.meta.dirname, "repositories", fixture.id);
    const actual = tree(source);
    assert.equal(actual.tree, fixture.tree);
    assert.equal(actual.paths.length, fixture.fileCount);
    assert.deepEqual(
      actual.paths
        .filter(
          (path) =>
            inputNames.has(path.split("/").at(-1)!) ||
            /^requirements.*\.txt$/.test(path.split("/").at(-1)!),
        )
        .sort(),
      [...fixture.files].sort(),
    );
    const result = parseResult(
      json(join(import.meta.dirname, "__snapshots__", `${fixture.id}.json`)),
    );
    assert.equal(result.codebase, `integration:${fixture.id.replace("+", "/")}@${fixture.pin}`);
    assert.deepEqual(
      sort(result.issues.map((issue) => [issue.code, issue.severity, issue.file])),
      sort(fixture.issues),
    );
    assert.equal(
      result.issues.some((issue) => issue.severity === "ERROR"),
      false,
    );
    const expectedGraphCounts: Record<string, Record<string, number>> = {
      "keithamus+sort-package-json": { packagejson: 1, packagelockjson: 1 },
      "linear+linear": { packagejson: 2, yarnlock: 4 },
      "lint-staged+lint-staged": { packagelockjson: 1 },
      "riehlegroup+mini-meco": { packagelockjson: 2 },
      "riehlegroup+msadoc": { packagejson: 1, packagelockjson: 1 },
      "sindresorhus+execa": { packagejson: 1 },
      "sindresorhus+got": { packagejson: 1 },
      "svg+svgo": { packagejson: 1, yarnberry: 2 },
      "terser+html-minifier-terser": { packagelockjson: 2 },
      "webpack-contrib+webpack-bundle-analyzer": { packagelockjson: 3, packagejson: 2 },
    };
    const observedGraphCounts: Record<string, number> = {};
    for (const graph of result.graphs)
      observedGraphCounts[graph.source.extractor] =
        (observedGraphCounts[graph.source.extractor] ?? 0) + 1;
    assert.deepEqual(observedGraphCounts, expectedGraphCounts[fixture.id]);
    const catalog = new Set(
      result.graphs.flatMap((graph) =>
        graph.nodes.filter((node) => !node.project).map((node) => node.purl),
      ),
    );
    assert.deepEqual([...catalog].sort(), result.packages.map((pkg) => pkg.purl).sort());
    for (const file of fixture.files.filter((path) => path.endsWith("package-lock.json")))
      assert.equal(
        result.graphs.filter(
          (graph) =>
            graph.source.extractor === "packagelockjson" && graph.source.files.includes(file),
        ).length,
        1,
      );
    for (const file of fixture.files.filter((path) => path.endsWith("yarn.lock")))
      assert.equal(
        result.graphs.filter(
          (graph) => graph.source.extractor.startsWith("yarn") && graph.source.files.includes(file),
        ).length,
        2,
      );
    const expectedManifestGroups: Record<string, string[][]> = {
      "keithamus+sort-package-json": [["package.json"]],
      "linear+linear": [
        ["examples/nextjs-file-upload/package.json"],
        [
          "package.json",
          "packages/codegen-doc/package.json",
          "packages/codegen-sdk/package.json",
          "packages/codegen-test/package.json",
          "packages/import/package.json",
          "packages/sdk/package.json",
        ],
      ],
      "lint-staged+lint-staged": [],
      "riehlegroup+mini-meco": [],
      "riehlegroup+msadoc": [["package.json"]],
      "sindresorhus+execa": [["package.json"]],
      "sindresorhus+got": [["package.json"]],
      "svg+svgo": [["package.json"]],
      "terser+html-minifier-terser": [],
      "webpack-contrib+webpack-bundle-analyzer": [
        ["test/webpack-versions/4.44.2/package.json"],
        ["test/webpack-versions/5.76.0/package.json"],
      ],
    };
    const rootDefinitions = (graph: DependencyGraph) =>
      [...new Set(graph.roots.map((root) => root.project.definitionFile))].sort();
    assert.deepEqual(
      sort(
        result.graphs
          .filter((graph) => graph.source.extractor === "packagejson")
          .map(rootDefinitions),
      ),
      sort(expectedManifestGroups[fixture.id]!),
    );
    const scopedYarn = result.graphs.filter(
      (graph) => graph.source.extractor.startsWith("yarn") && graph.roots.length > 0,
    );
    if (fixture.id === "linear+linear")
      assert.deepEqual(
        sort(scopedYarn.map(rootDefinitions)),
        sort(expectedManifestGroups[fixture.id]!),
      );
    if (fixture.id === "svg+svgo")
      assert.deepEqual(scopedYarn.map(rootDefinitions), [["package.json"], ["package.json"]]);
    for (const graph of result.graphs) {
      if (graph.source.extractor === "packagejson") assertDeclared(graph, source);
      else if (graph.source.extractor === "packagelockjson") assertNpm(graph, source);
      else if (graph.source.extractor === "yarnlock" || graph.source.extractor === "yarnberry")
        assertYarn(graph, source);
      else assert.fail(`Unreviewed extractor ${graph.source.extractor}`);
    }
    if (fixture.id === "sindresorhus+execa" || fixture.id === "sindresorhus+got") {
      assert.deepEqual(result.packages, []);
      assert.equal(result.graphs.length, 1);
      for (const root of result.graphs[0]!.roots) {
        const closure = queryDependencies(result, { graph: result.graphs[0]!.id, root: root.id });
        assert.deepEqual(closure.definite, []);
        assert.deepEqual(closure.conditional, []);
        assert.equal(closure.completeness, closure.declarations.length ? "unknown" : "complete");
      }
    }
  });
}
