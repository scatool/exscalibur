import { createRequire } from "node:module";
import { dirname, join, normalize, relative } from "node:path/posix";
import { expect } from "vite-plus/test";
import { type DependencyEdge, type DependencyGraph } from "@scatool/analyzer-core";

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
const require = createRequire(
  new URL("../../packages/analyzer-plugin-javascript/package.json", import.meta.url),
);
const yaml = require("yaml") as {
  parse: (text: string, options?: object) => Record<string, RecordValue>;
};
const classic = require("@yarnpkg/lockfile") as {
  parse: (text: string) => { type: string; object: Record<string, RecordValue> };
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown) => (value ?? {}) as RecordValue;
const table = (value: unknown) => record(value) as Record<string, string>;
const { PackageURL } = require("packageurl-js") as {
  PackageURL: {
    fromString: (value: string) => { name: string; namespace?: string; version?: string };
  };
};
const semver = require("semver") as { satisfies: (version: string, range: string) => boolean };
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const edgeTuples = (edges: DependencyEdge[]) =>
  edges
    .map((edge) => [edge.kind, edge.requested?.name, edge.requested?.specifier ?? null])
    .sort(compareNative);

export function checkDeclarations(graph: DependencyGraph, source: (path: string) => string) {
  const files = graph.source.files.filter((file) => file.endsWith("package.json"));
  expect(
    graph.roots.map((root) => [root.project.definitionFile, root.scope]).sort(compareNative),
  ).toEqual(files.flatMap((file) => scopes.map((scope) => [file, scope])).sort(compareNative));
  expect(graph.nodes).toHaveLength(files.length * 5);
  for (const root of graph.roots) {
    const manifest = JSON.parse(source(root.project.definitionFile)) as RecordValue;
    const edges = graph.edges.filter((edge) => edge.from === root.node);
    expect(edgeTuples(edges)).toEqual(
      Object.entries(table(manifest[root.scope]))
        .map(([name, spec]) => [root.scope, name, spec])
        .sort(compareNative),
    );
    expect(edges.every((edge) => edge.status === "declared")).toBe(true);
    expect(edges.every((edge) => !Object.hasOwn(edge, "to"))).toBe(true);
  }
}

const purlName = (value: string) => {
  const purl = PackageURL.fromString(value);
  return purl.namespace ? `${purl.namespace}/${purl.name}` : purl.name;
};
const descriptorName = (value: string) =>
  value.slice(0, value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0));
export function checkYarn(graph: DependencyGraph, source: (path: string) => string) {
  const text = source(graph.source.files.find((file) => file.endsWith("yarn.lock"))!);
  const modern = graph.source.extractor === "yarnberry";
  const raw = modern ? yaml.parse(text, { schema: "failsafe" }) : classic.parse(text).object;
  const records = new Map<string, { metadata: RecordValue; descriptors: string[] }>();
  if (modern) {
    for (const [key, metadata] of Object.entries(raw)) {
      if (key === "__metadata") continue;
      const locator = String(metadata.resolution);
      const previous = records.get(locator);
      if (previous) {
        expect(previous.metadata).toEqual(metadata);
        previous.descriptors.push(...key.split(/ *, */));
      } else records.set(locator, { metadata, descriptors: key.split(/ *, */) });
    }
  } else {
    const groups = new Map<RecordValue, string[]>();
    for (const [key, metadata] of Object.entries(raw))
      groups.set(metadata, [...(groups.get(metadata) ?? []), key]);
    for (const [metadata, descriptors] of groups)
      records.set([...descriptors].sort(compareNative).join(", "), { metadata, descriptors });
  }
  const byDescriptor = new Map<string, string>();
  for (const [locator, entry] of records)
    for (const descriptor of entry.descriptors) {
      byDescriptor.set(descriptor, locator);
      if (modern && Number(raw.__metadata?.version) <= 6) {
        const index = descriptor.indexOf(
          "@",
          descriptor.startsWith("@") ? descriptor.indexOf("/") + 1 : 0,
        );
        const reference = descriptor.slice(index + 1);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(reference))
          byDescriptor.set(`${descriptor.slice(0, index)}@npm:${reference}`, locator);
      }
    }
  const scoped = graph.attributes?.["yarn:observation"] === "current-manifest-scopes";
  if (!scoped)
    expect(graph.roots).toHaveLength(
      [...records.keys()].filter((locator) => locator.includes("@workspace:")).length,
    );
  const native = graph.nodes.filter((node) => node.attributes?.["yarn:record"] !== undefined);
  expect(native).toHaveLength(records.size);
  expect(graph.attributes?.["yarn:projection"]).toBe("raw-descriptor-map");
  expect(graph.attributes?.["yarn:effectiveResolution"]).toBe("not-observed");
  for (const node of native) {
    const entry = records.get(node.locator!)!;
    expect(entry).toBeDefined();
    expect(node.attributes?.["yarn:record"]).toEqual(entry.metadata);
    if (!node.project || !scoped)
      expect(node.dependencyCompleteness).toBe(modern ? "complete" : "unknown");
    if (!node.project) {
      const descriptor = entry.descriptors[0]!;
      const name = modern
        ? descriptorName(node.locator!)
        : descriptor.includes("@npm:")
          ? descriptorName(descriptor.slice(descriptor.indexOf("@npm:") + 5))
          : descriptorName(descriptor);
      expect(purlName(node.purl)).toBe(name.toLowerCase());
    }
    if (!node.project)
      expect(PackageURL.fromString(node.purl).version ?? "").toBe(
        entry.metadata.version === "0.0.0-use.local" ? "" : entry.metadata.version,
      );
    const descriptors = node.attributes?.["yarn:descriptors"];
    expect(Array.isArray(descriptors)).toBe(true);
    expect([...(descriptors as string[])].sort(compareNative)).toEqual(
      [...entry.descriptors].sort(compareNative),
    );
    if (scoped && node.project) continue;
    const expected = ["dependencies", "optionalDependencies", "peerDependencies"]
      .flatMap((scope) =>
        Object.entries(table(entry.metadata[scope])).map(([name, spec]) => [
          scope === "peerDependencies" ? scope : node.project ? "yarn:dependencies" : scope,
          name,
          spec,
        ]),
      )
      .sort(compareNative);
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    expect(edgeTuples(edges)).toEqual(expected);
    if (node.project && !scoped) {
      const root = graph.roots.find(
        (root) => root.project.definitionFile === node.project!.definitionFile,
      )!;
      expect(root.scope).toBe("yarn:dependencies");
      expect(edgeTuples(graph.edges.filter((edge) => edge.from === root.node))).toEqual(expected);
    }
    for (const edge of edges) {
      if (edge.kind === "peerDependencies") {
        expect(edge.status).toBe("declared");
        expect(edge.selection).toBe("unknown");
        continue;
      }
      const name = edge.requested!.name!,
        spec = edge.requested!.specifier!;
      const locator =
        byDescriptor.get(`${name}@${spec}`) ??
        (modern ? byDescriptor.get(`${name}@npm:${spec}`) : undefined);
      if (locator) {
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((target) => target.id === edge.to)?.locator).toBe(locator);
        expect(["selected", "conditional"]).toContain(edge.selection);
      } else if (!modern && edge.status === "resolved") {
        const target = graph.nodes.find((target) => target.id === edge.to)!;
        expect(target.project).toBeDefined();
        const manifest = JSON.parse(source(target.project!.definitionFile));
        expect(manifest.name).toBe(name);
        expect(semver.satisfies(manifest.version, spec)).toBe(true);
      } else expect(edge.status).not.toBe("resolved");
    }
  }
  if (scoped && modern) {
    const equivalent = (a: string, b: string) => a.replace(/^npm:/, "") === b.replace(/^npm:/, "");
    for (const file of graph.source.files.filter((file) => file.endsWith("package.json"))) {
      const manifest = JSON.parse(source(file));
      const workspace = [...records.values()].find((entry) =>
        String(entry.metadata.resolution).endsWith(`@workspace:${dirname(file)}`),
      );
      expect(workspace).toBeDefined();
      const nativeRequests = table(workspace!.metadata.dependencies);
      const declarations = scopes.flatMap((scope) =>
        Object.entries(table(manifest[scope])).map(([name, spec]) => ({ scope, name, spec })),
      );
      let drift = Object.entries(nativeRequests).some(
        ([name, spec]) =>
          !declarations.some(
            (decl) =>
              decl.scope !== "peerDependencies" &&
              decl.name === name &&
              equivalent(spec, decl.spec),
          ),
      );
      for (const root of graph.roots.filter((root) => root.project.definitionFile === file)) {
        for (const edge of graph.edges.filter(
          (edge) => edge.from === root.node && edge.kind !== "peerDependencies",
        )) {
          const nativeSpec = nativeRequests[edge.requested!.name!];
          if (!nativeSpec || !equivalent(nativeSpec, edge.requested!.specifier!)) {
            drift = true;
            if (edge.selection !== "excluded") expect(edge.selection).toBe("unknown");
          }
        }
      }
      if (drift)
        for (const node of graph.nodes.filter((node) => node.project?.definitionFile === file))
          expect(node.dependencyCompleteness).toBe("partial");
    }
  }
  for (const edge of graph.edges.filter((edge) => edge.status === "resolved")) {
    const descriptor = nativeString(edge.attributes?.["yarn:descriptor"]);
    const locator =
      byDescriptor.get(descriptor) ??
      byDescriptor.get(
        `${descriptorName(descriptor)}@npm:${descriptor.slice(descriptorName(descriptor).length + 1)}`,
      );
    const target = graph.nodes.find((node) => node.id === edge.to)!;
    if (locator) expect(target.locator).toBe(locator);
    else {
      expect(modern).toBe(false);
      expect(target.project).toBeDefined();
      const manifest = JSON.parse(source(target.project!.definitionFile));
      expect(manifest.name).toBe(edge.requested!.name);
      expect(semver.satisfies(manifest.version, edge.requested!.specifier!)).toBe(true);
    }
  }
}

export function checkNpm(graph: DependencyGraph, source: (path: string) => string) {
  const file = graph.source.files.find((path) =>
    /(?:package-lock|npm-shrinkwrap)\.json$/.test(path),
  )!;
  const lock = JSON.parse(source(file)) as { packages: Record<string, RecordValue> };
  expect(lock.packages).toBeDefined();
  const entries = Object.entries(lock.packages).filter(
    ([path, metadata]) => path.split("/").includes("node_modules") && !metadata.link,
  );
  expect(graph.nodes.filter((node) => !node.project)).toHaveLength(entries.length);
  const follow = (path: string): string | undefined => {
    const seen = new Set<string>();
    while (lock.packages[path]?.link) {
      if (seen.has(path)) throw new Error("Cyclic native link");
      seen.add(path);
      path = normalize(String(lock.packages[path]!.resolved));
      if (path === ".") path = "";
    }
    return lock.packages[path] ? path : undefined;
  };
  const target = (owner: string, name: string): string | undefined => {
    for (let path = owner; ; path = dirname(path)) {
      if (!path.endsWith("node_modules")) {
        const candidate = join(path, "node_modules", name).replace(/^\.\//, "");
        if (Object.hasOwn(lock.packages, candidate)) return follow(candidate);
      }
      if (path === "" || path === ".") return undefined;
    }
  };
  const projectEntries = Object.entries(lock.packages).filter(
    ([path]) => !path.split("/").includes("node_modules"),
  );
  expect(
    graph.roots.map((root) => [root.project.definitionFile, root.scope]).sort(compareNative),
  ).toEqual(
    projectEntries
      .flatMap(([path]) =>
        scopes.map((scope) => [join(dirname(file), path, "package.json"), scope]),
      )
      .sort(compareNative),
  );
  for (const root of graph.roots) {
    const path = dirname(root.project.definitionFile).slice(
      dirname(file) === "." ? 0 : dirname(file).length + 1,
    );
    const owner = path === "." ? "" : path;
    const metadata = lock.packages[owner]!;
    expect(metadata).toBeDefined();
    const edges = graph.edges.filter((edge) => edge.from === root.node);
    expect(edgeTuples(edges)).toEqual(
      Object.entries(table(metadata[root.scope]))
        .map(([name, spec]) => [root.scope, name, spec])
        .sort(compareNative),
    );
    for (const edge of edges) {
      const location = target(owner, edge.requested!.name!);
      if (location !== undefined) {
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((node) => node.id === edge.to)?.locator).toBe(location);
      } else expect(edge.status).not.toBe("resolved");
    }
  }
  for (const [path, metadata] of entries) {
    const node = graph.nodes.find((node) => node.locator === path)!;
    expect(node).toBeDefined();
    expect(node.attributes?.["npm:metadata"]).toEqual(metadata);
    expect(purlName(node.purl)).toBe(
      metadata.name ?? path.slice(path.lastIndexOf("node_modules/") + 13),
    );
    expect(node.dependencyCompleteness).toBe("complete");
    expect(PackageURL.fromString(node.purl).version ?? "").toBe(metadata.version ?? "");
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    expect(edgeTuples(edges)).toEqual(
      scopes
        .flatMap((scope) =>
          Object.entries(table(metadata[scope])).map(([name, spec]) => [scope, name, spec]),
        )
        .sort(compareNative),
    );
    for (const edge of edges) {
      const location = target(path, edge.requested!.name!);
      if (location !== undefined) {
        expect(edge.status).toBe("resolved");
        const to = graph.nodes.find((candidate) => candidate.id === edge.to)!;
        expect(to.locator).toBe(location);
      } else expect(edge.status).not.toBe("resolved");
    }
  }
}

export function checkPnpm(graph: DependencyGraph, source: (path: string) => string) {
  const file = graph.source.files.find((path) => path.endsWith("pnpm-lock.yaml"))!;
  const lock = yaml.parse(source(file));
  const snapshots = record(lock.snapshots);
  expect(
    graph.nodes.filter((node) => node.attributes?.["pnpm:snapshot"] !== undefined),
  ).toHaveLength(Object.keys(snapshots).length);
  for (const [key, value] of Object.entries(snapshots)) {
    const node = graph.nodes.find((node) => node.locator === key)!;
    expect(node).toBeDefined();
    expect(node.attributes?.["pnpm:snapshot"]).toEqual(value);
    expect(node.dependencyCompleteness).toBe("complete");
    const base = key.split("(")[0]!;
    const at = base.lastIndexOf("@");
    expect(purlName(node.purl)).toBe(base.slice(0, at));
    expect(PackageURL.fromString(node.purl).version).toBe(base.slice(at + 1));
    const snapshot = record(value);
    const edges = graph.edges.filter((edge) => edge.from === node.id);
    const wanted = ["dependencies", "optionalDependencies"].flatMap((scope) =>
      Object.entries(table(snapshot[scope])).map(([name, ref]) => [name, ref]),
    );
    expect(
      edges
        .filter((edge) => edge.attributes?.["pnpm:dependencyReference"] !== undefined)
        .map((edge) => [edge.requested?.name, edge.attributes?.["pnpm:dependencyReference"]])
        .sort(compareNative),
    ).toEqual(wanted.sort(compareNative));
    for (const edge of edges) {
      const ref = edge.attributes?.["pnpm:dependencyReference"];
      if (typeof ref !== "string") continue;
      const expected = ref.startsWith("link:")
        ? undefined
        : Object.hasOwn(snapshots, ref)
          ? ref
          : `${edge.requested!.name}@${ref}`;
      if (ref.startsWith("link:")) {
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((node) => node.id === edge.to)?.project?.definitionFile).toBe(
          join(dirname(file), ref.slice(5), "package.json"),
        );
      } else {
        expect(Object.hasOwn(snapshots, expected!)).toBe(true);
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((node) => node.id === edge.to)?.locator).toBe(expected);
      }
      expect(["selected", "conditional"]).toContain(edge.selection);
    }
  }
  expect(
    graph.roots.map((root) => [root.project.definitionFile, root.scope]).sort(compareNative),
  ).toEqual(
    Object.keys(record(lock.importers))
      .flatMap((location) =>
        scopes.map((scope) => [join(dirname(file), location, "package.json"), scope]),
      )
      .sort(compareNative),
  );
  for (const root of graph.roots) {
    const location = relative(dirname(file), dirname(root.project.definitionFile)) || ".";
    const importer = record(record(lock.importers)[location]);
    const expected = Object.entries(record(importer[root.scope]));
    const edges = graph.edges.filter((edge) => edge.from === root.node);
    expect(
      edges.map((edge) => [edge.requested?.name, edge.requested?.specifier]).sort(compareNative),
    ).toEqual(expected.map(([name, value]) => [name, record(value).specifier]).sort(compareNative));
    for (const edge of edges) {
      const ref = String(
        record(importer[root.scope])[edge.requested!.name!] &&
          record(record(importer[root.scope])[edge.requested!.name!]).version,
      );
      if (ref.startsWith("link:")) {
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((node) => node.id === edge.to)?.project?.definitionFile).toBe(
          join(dirname(file), location, ref.slice(5), "package.json"),
        );
      } else {
        const expected = Object.hasOwn(snapshots, ref) ? ref : `${edge.requested!.name}@${ref}`;
        expect(Object.hasOwn(snapshots, expected)).toBe(true);
        expect(edge.status).toBe("resolved");
        expect(graph.nodes.find((node) => node.id === edge.to)?.locator).toBe(expected);
      }
      expect(["selected", "conditional"]).toContain(edge.selection);
    }
  }
}

export function checkNativeFacts(graph: DependencyGraph, source: (path: string) => string) {
  const file = graph.source.files.find((path) =>
    /(?:yarn\.lock|package-lock\.json|pnpm-lock\.yaml)$/.test(path),
  );
  const metadata = new Map<string, RecordValue>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const workspaceRecords = new Map(
    graph.nodes
      .filter((node) => node.project && node.attributes?.["yarn:record"])
      .map((node) => [node.project!.definitionFile, node.attributes!["yarn:record"]]),
  );
  const pnpm = file?.endsWith("pnpm-lock.yaml") ? yaml.parse(source(file)) : undefined;
  const npm = file?.endsWith("package-lock.json") ? JSON.parse(source(file)) : undefined;
  for (const node of graph.nodes) {
    let raw: RecordValue = {};
    if (node.project) {
      if (npm) {
        const location = dirname(node.project.definitionFile).slice(
          dirname(file!) === "." ? 0 : dirname(file!).length + 1,
        );
        raw = record(npm.packages[location === "." ? "" : location]);
      } else raw = JSON.parse(source(node.project.definitionFile));
      if (raw.name) expect(purlName(node.purl)).toBe(nativeString(raw.name).toLowerCase());
      if (raw.version) expect(PackageURL.fromString(node.purl).version).toBe(raw.version);
    } else if (pnpm) raw = record(record(pnpm.packages)[node.locator!.split("(")[0]!]);
    else if (npm) raw = record(npm.packages[node.locator!]);
    else raw = record(node.attributes?.["yarn:record"]);
    metadata.set(node.id, raw);
    if (!node.project) {
      const resolution = record(raw.resolution);
      const location = pnpm ? resolution.tarball : raw.resolved;
      const integrity = pnpm ? resolution.integrity : raw.integrity;
      expect(node.artifacts).toEqual(
        location || integrity
          ? [
              {
                ...(location ? { location } : {}),
                ...(integrity ? { attributes: { "npm:integrity": integrity } } : {}),
                evidence: [file],
              },
            ]
          : undefined,
      );
    }
  }
  for (const edge of graph.edges) {
    const raw =
      graph.attributes?.["yarn:observation"] === "native-lock"
        ? record(
            nodesById.get(edge.from)?.attributes?.["yarn:record"] ??
              workspaceRecords.get(nodesById.get(edge.from)?.project?.definitionFile ?? ""),
          )
        : metadata.get(edge.from)!;
    const targetNode = nodesById.get(edge.to!);
    const target = edge.to
      ? graph.source.extractor.startsWith("yarn")
        ? record(targetNode?.attributes?.["yarn:record"])
        : metadata.get(edge.to)
      : undefined;
    const platform = Object.fromEntries(
      ["os", "cpu", "libc"].flatMap((key) =>
        target?.[key] !== undefined ? [[key, target[key]]] : [],
      ),
    );
    const condition =
      target?.conditions !== undefined
        ? {
            language: "yarn:applicability/v1",
            expression: {
              conditions: target.conditions,
              ...(Object.keys(platform).length ? { platform } : {}),
            },
          }
        : Object.keys(platform).length
          ? { language: "npm:platform/v1", expression: platform }
          : undefined;
    expect(edge.condition).toEqual(edge.selection === "excluded" ? undefined : condition);
    const from = nodesById.get(edge.from)!;
    const consumer = !!from.project && !graph.roots.some((root) => root.node === from.id);
    const peer = edge.kind === "peerDependencies";
    const name = edge.requested!.name!;
    if (npm) {
      const optional =
        edge.kind === "optionalDependencies" ||
        (peer && record(record(raw.peerDependenciesMeta)[name]).optional === true);
      expect(edge.optional).toBe(optional);
      const excluded =
        (edge.kind === "dependencies" && Object.hasOwn(record(raw.optionalDependencies), name)) ||
        (consumer && edge.kind === "devDependencies") ||
        (peer && optional && !edge.to);
      const selection = excluded
        ? "excluded"
        : peer || (optional && !edge.to)
          ? "unknown"
          : condition
            ? "conditional"
            : "selected";
      expect(edge.selection).toBe(selection);
    } else if (pnpm) {
      const binding = edge.attributes?.["pnpm:bindingScope"];
      const optional =
        (binding ?? edge.kind) === "optionalDependencies" ||
        (peer && record(record(raw.peerDependenciesMeta)[name]).optional === true);
      expect(edge.optional).toBe(optional);
      const excluded =
        (consumer && edge.kind === "devDependencies") || (peer && !edge.to && optional);
      expect(edge.selection).toBe(
        excluded
          ? "excluded"
          : peer && !edge.to
            ? "unknown"
            : condition
              ? "conditional"
              : "selected",
      );
    } else if (
      graph.attributes?.["yarn:observation"] === "current-manifest-scopes" &&
      from.project
    ) {
      const native = record(
        graph.nodes.find(
          (node) =>
            node.project?.definitionFile === from.project!.definitionFile &&
            node.attributes?.["yarn:record"],
        )?.attributes?.["yarn:record"],
      );
      const nativeReference = table(native.dependencies)[name];
      const optional =
        edge.kind === "optionalDependencies" ||
        (peer &&
          [true, "true"].includes(
            record(record(raw.peerDependenciesMeta)[name]).optional as boolean | string,
          ));
      expect(edge.optional).toBe(optional);
      const excluded =
        (edge.kind === "dependencies" && Object.hasOwn(record(raw.optionalDependencies), name)) ||
        (consumer && edge.kind === "devDependencies");
      const correlated =
        !peer &&
        nativeReference !== undefined &&
        nativeReference.replace(/^npm:/, "") === edge.requested!.specifier!.replace(/^npm:/, "");
      expect(edge.selection).toBe(
        excluded ? "excluded" : !correlated ? "unknown" : condition ? "conditional" : "selected",
      );
    } else if (graph.attributes?.["yarn:observation"] === "native-lock") {
      const optional =
        edge.kind === "optionalDependencies" ||
        [true, "true"].includes(
          record(record(peer ? raw.peerDependenciesMeta : raw.dependenciesMeta)[name]).optional as
            | boolean
            | string,
        );
      expect(edge.optional).toBe(optional);
      expect(edge.selection).toBe(
        peer || (optional && !edge.to) ? "unknown" : condition ? "conditional" : "selected",
      );
    }
  }
}
