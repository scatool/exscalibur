import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { queryDependencies, validateResult, type DependencyGraph } from "@scatool/analyzer-core";
import { extractor } from "./index.ts";

type RecordValue = Record<string, unknown>;
const owner = "node_modules/@scope/engine";
const runtime = "@emnapi/runtime";

async function withLock(
  packages: Record<string, RecordValue>,
  run: (graph: DependencyGraph, directory: string) => Promise<void> | void,
  lockfileVersion = 3,
) {
  const directory = await mkdtemp(join(tmpdir(), "npm-bundles-"));
  const manifest = packages[""] ?? {
    name: "app",
    version: "1.0.0",
    optionalDependencies: { "@scope/engine": "4.3.3" },
  };

  try {
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
    await writeFile(
      join(directory, "package-lock.json"),
      JSON.stringify({ lockfileVersion, packages: { "": manifest, ...packages } }),
    );

    const result = await extractor.extract(directory, {}, { codebaseId: "test:bundles" });
    validateResult(result);
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    const graph = result.graphs.find((item) => item.interpretation === "locked")!;
    await run(graph, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function outgoing(graph: DependencyGraph, location: string, name: string, kind = "dependencies") {
  const source = graph.nodes.find((node) => node.locator === location)!;
  return graph.edges.find(
    (edge) => edge.from === source.id && edge.requested?.name === name && edge.kind === kind,
  )!;
}

function targetLocation(graph: DependencyGraph, edge: ReturnType<typeof outgoing>) {
  return edge.status === "resolved"
    ? graph.nodes.find((node) => node.id === edge.to)?.locator
    : undefined;
}

for (const lockfileVersion of [2, 3]) {
  for (const spelling of ["bundleDependencies", "bundledDependencies"]) {
    test.each([[runtime], true, { [runtime]: true }].map((bundles) => ({ bundles })))(
      `lock v${lockfileVersion} ${spelling}=%j does not substitute an outer package for unreported bundle contents`,
      async ({ bundles }) => {
        await withLock(
          {
            [owner]: {
              version: "4.3.3",
              dependencies: { [runtime]: "^1.11.1" },
              [spelling]: bundles,
              optional: true,
              cpu: ["wasm32"],
            },
            [`node_modules/${runtime}`]: { version: "1.11.3" },
          },
          async (graph, directory) => {
            expect(outgoing(graph, owner, runtime)).toMatchObject({ status: "unresolved" });
            const incoming = graph.edges.find(
              (edge) =>
                edge.requested?.name === "@scope/engine" && edge.kind === "optionalDependencies",
            )!;
            expect(incoming).toMatchObject({
              status: "resolved",
              optional: true,
              selection: "conditional",
              condition: { language: "npm:platform/v1", expression: { cpu: ["wasm32"] } },
            });

            const result = await extractor.extract(directory, {}, { codebaseId: "test:bundles" });
            const root = graph.roots.find((item) => item.scope === "optionalDependencies")!;
            const closure = queryDependencies(result, { graph: graph.id, root: root.id });
            // An active request with an unresolved binding makes a locked closure partial.
            expect(closure.completeness).toBe("partial");
            expect(closure.definite).toEqual([]);
            expect(closure.conditional).not.toContain(
              graph.nodes.find((node) => node.locator === `node_modules/${runtime}`)!.id,
            );
          },
          lockfileVersion,
        );
      },
    );
  }
}

test.each([false, []].map((bundles) => ({ bundles })))(
  "the canonical bundle field %j takes precedence over its alias",
  async ({ bundles }) => {
    await withLock(
      {
        [owner]: {
          version: "4.3.3",
          dependencies: { [runtime]: "^1.11.1" },
          bundleDependencies: bundles,
          bundledDependencies: [runtime],
        },
        [`node_modules/${runtime}`]: { version: "1.11.3" },
      },
      (graph) =>
        expect(targetLocation(graph, outgoing(graph, owner, runtime))).toBe(
          `node_modules/${runtime}`,
        ),
    );
  },
);

test("true bundles declared dependencies, including optional duplicates, but not optional-only or peer names", async () => {
  await withLock(
    {
      [owner]: {
        version: "4.3.3",
        dependencies: { duplicate: "1" },
        optionalDependencies: { duplicate: "1", optionalOnly: "1" },
        peerDependencies: { peer: "1" },
        bundleDependencies: true,
      },
      "node_modules/duplicate": { version: "1" },
      "node_modules/optionalOnly": { version: "1" },
      "node_modules/peer": { version: "1" },
    },
    (graph) => {
      expect(outgoing(graph, owner, "duplicate", "optionalDependencies")).toMatchObject({
        status: "unresolved",
        optional: true,
        selection: "unknown",
      });
      expect(
        targetLocation(graph, outgoing(graph, owner, "optionalOnly", "optionalDependencies")),
      ).toBe("node_modules/optionalOnly");
      expect(targetLocation(graph, outgoing(graph, owner, "peer", "peerDependencies"))).toBe(
        "node_modules/peer",
      );
    },
  );
});

test.each(["1.11.1", "1.11.3"])(
  "a recorded bundled runtime %s keeps its package-local view even beside an outer copy",
  async (version) => {
    await withLock(
      {
        [owner]: {
          version: "4.3.3",
          dependencies: { [runtime]: "^1.11.1", ordinary: "2" },
          bundleDependencies: [runtime],
        },
        [`${owner}/node_modules/${runtime}`]: { version, inBundle: true },
        [`node_modules/${runtime}`]: { version: "1.11.3" },
        "node_modules/ordinary": { version: "2" },
      },
      (graph) => {
        const edge = outgoing(graph, owner, runtime);
        expect(targetLocation(graph, edge)).toBe(`${owner}/node_modules/${runtime}`);
        expect(
          graph.nodes.find((node) => edge.status === "resolved" && node.id === edge.to)?.purl,
        ).toBe(`pkg:npm/%40emnapi/runtime@${version}`);
        expect(targetLocation(graph, outgoing(graph, owner, "ordinary"))).toBe(
          "node_modules/ordinary",
        );
      },
    );
  },
);

test.each([false, true])(
  "bundled descendants resolve a hoisted local sibling when reported=%s, without escaping the archive",
  async (reported) => {
    const child = `${owner}/node_modules/@scope/child`;
    await withLock(
      {
        [owner]: {
          version: "1",
          dependencies: { "@scope/child": "1", shared: "*", ordinary: "2" },
          bundleDependencies: ["@scope/child"],
        },
        [child]: {
          version: "1",
          inBundle: true,
          dependencies: { shared: "*" },
          peerDependencies: { peer: "3" },
        },
        ...(reported ? { [`${owner}/node_modules/shared`]: { version: "1", inBundle: true } } : {}),
        "node_modules/shared": { version: "2" },
        "node_modules/ordinary": { version: "2" },
        "node_modules/peer": { version: "3" },
      },
      (graph) => {
        for (const location of [owner, child]) {
          const edge = outgoing(graph, location, "shared");
          if (reported) expect(targetLocation(graph, edge)).toBe(`${owner}/node_modules/shared`);
          else expect(edge.status).toBe("unresolved");
        }
        expect(targetLocation(graph, outgoing(graph, owner, "ordinary"))).toBe(
          "node_modules/ordinary",
        );
        expect(targetLocation(graph, outgoing(graph, child, "peer", "peerDependencies"))).toBe(
          "node_modules/peer",
        );
      },
    );
  },
);

test.each([2, 3])(
  "lock v%s inBundle records retain archive boundaries even when the owner's bundle list is absent",
  async (version) => {
    const child = `${owner}/node_modules/child`;
    await withLock(
      {
        [owner]: { version: "1", dependencies: { child: "1" } },
        [child]: { version: "1", inBundle: true, dependencies: { shared: "*" } },
        "node_modules/shared": { version: "2" },
      },
      (graph) => expect(outgoing(graph, child, "shared").status).toBe("unresolved"),
      version,
    );
  },
);

test("root and workspace bundle declarations describe packing intent, not installed archive boundaries", async () => {
  await withLock(
    {
      "": {
        name: "app",
        version: "1",
        dependencies: { runtime: "1" },
        bundleDependencies: ["runtime"],
      },
      "packages/workspace": {
        name: "workspace",
        version: "1",
        dependencies: { runtime: "1" },
        bundleDependencies: ["runtime"],
      },
      "node_modules/workspace": { link: true, resolved: "packages/workspace" },
      "node_modules/runtime": { version: "1" },
    },
    (graph) => {
      for (const location of ["", "packages/workspace"])
        expect(targetLocation(graph, outgoing(graph, location, "runtime"))).toBe(
          "node_modules/runtime",
        );
    },
  );
});

test("legacy bundled records retain missing transitive uncertainty without replacing recorded local versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "npm-legacy-bundle-"));
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "app", version: "1", dependencies: { engine: "1" } }),
    );
    await writeFile(
      join(directory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          engine: {
            version: "1",
            requires: { child: "1" },
            dependencies: {
              child: { version: "1", bundled: true, requires: { shared: "*" } },
            },
          },
          child: { version: "2" },
          shared: { version: "2" },
        },
      }),
    );
    const result = await extractor.extract(directory, {}, { codebaseId: "test:legacy-bundle" });
    validateResult(result);
    const graph = result.graphs.find((item) => item.interpretation === "locked")!;
    expect(targetLocation(graph, outgoing(graph, "node_modules/engine", "child"))).toBe(
      "node_modules/engine/node_modules/child",
    );
    expect(outgoing(graph, "node_modules/engine/node_modules/child", "shared").status).toBe(
      "unresolved",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "a nested explicit bundle keeps its nearer boundary when local records are reported=%s",
  async (reported) => {
    const child = `${owner}/node_modules/child`;
    const nested = `${child}/node_modules/nested`;
    await withLock(
      {
        [owner]: { version: "1", dependencies: { child: "1" }, bundleDependencies: ["child"] },
        [child]: {
          version: "1",
          inBundle: true,
          dependencies: { nested: "1", direct: "*" },
          bundleDependencies: ["nested", "direct"],
        },
        [nested]: { version: "1", inBundle: true, dependencies: { transitive: "*" } },
        [`${owner}/node_modules/direct`]: { version: "2", inBundle: true },
        [`${owner}/node_modules/transitive`]: { version: "2", inBundle: true },
        ...(reported
          ? {
              [`${child}/node_modules/direct`]: { version: "1", inBundle: true },
              [`${child}/node_modules/transitive`]: { version: "1", inBundle: true },
            }
          : {}),
      },
      (graph) => {
        for (const [source, name] of [
          [child, "direct"],
          [nested, "transitive"],
        ]) {
          const edge = outgoing(graph, source!, name!);
          if (reported) expect(targetLocation(graph, edge)).toBe(`${child}/node_modules/${name}`);
          else expect(edge.status).toBe("unresolved");
        }
      },
    );
  },
);

test("a bundle-local link cannot substitute a workspace outside the archive", async () => {
  await withLock(
    {
      [owner]: { version: "1", dependencies: { runtime: "1" }, bundleDependencies: ["runtime"] },
      [`${owner}/node_modules/runtime`]: { link: true, resolved: "packages/runtime" },
      "packages/runtime": { name: "runtime", version: "1" },
    },
    (graph) => expect(outgoing(graph, owner, "runtime").status).toBe("unresolved"),
  );
});

test("a recorded child's nested dependency does not shadow the owner's unrelated outer binding", async () => {
  const child = `${owner}/node_modules/child`;
  await withLock(
    {
      [owner]: {
        version: "1",
        dependencies: { child: "1", shared: "*" },
        bundleDependencies: ["child"],
      },
      [child]: { version: "1", inBundle: true, dependencies: { shared: "*" } },
      [`${child}/node_modules/shared`]: { version: "1", inBundle: true },
      "node_modules/shared": { version: "2" },
    },
    (graph) => {
      expect(targetLocation(graph, outgoing(graph, child, "shared"))).toBe(
        `${child}/node_modules/shared`,
      );
      expect(targetLocation(graph, outgoing(graph, owner, "shared"))).toBe("node_modules/shared");
    },
  );
});

test("a bundle list does not turn peer-only or development-only packages into bundled descendants", async () => {
  await withLock(
    {
      [owner]: {
        version: "1",
        peerDependencies: { peer: "1" },
        devDependencies: { development: "1" },
        bundleDependencies: ["peer", "development"],
      },
      [`${owner}/node_modules/peer`]: { version: "1", dependencies: { shared: "1" } },
      [`${owner}/node_modules/development`]: { version: "1", dependencies: { shared: "1" } },
      "node_modules/shared": { version: "1" },
    },
    (graph) => {
      for (const name of ["peer", "development"])
        expect(
          targetLocation(graph, outgoing(graph, `${owner}/node_modules/${name}`, "shared")),
        ).toBe("node_modules/shared");
    },
  );
});

// Reduced from Porsche Design System v4.9.0's unchanged package-lock.json:
// https://github.com/porsche-design-system/porsche-design-system/blob/0a4e610aa5acdc72147d6ea96e5ab197497fa1e9/package-lock.json
// Source SHA256: 99e6c2c6f0dd66d15ac73ad751f1b0754126806e29aa6c58c1548f8173b5ea04.
// The published oxide-wasm32-wasi-4.3.3.tgz matched the lock's SHA512 integrity;
// https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz
// archive SHA256: d5b61fbe10d237f7565032a74b03b5be6c83b309037ee407e2b5b46f24738823.
// Inspection found bundled @emnapi/runtime 1.11.1 versus outer lockfile 1.11.3,
// and a separate bundled tslib 2.8.1 view despite its matching outer version.
// This regression uses only lock records: it neither downloads nor executes the archive.
test("the Porsche oxide lock record cannot establish any of its six unreported bundled views", async () => {
  const oxide = "@tailwindcss/oxide-wasm32-wasi";
  const dependencies = {
    "@emnapi/core": "^1.11.1",
    "@emnapi/runtime": "^1.11.1",
    "@emnapi/wasi-threads": "^1.2.2",
    "@napi-rs/wasm-runtime": "^1.1.4",
    "@tybys/wasm-util": "^0.10.2",
    tslib: "^2.8.1",
  };
  await withLock(
    {
      "": { name: "oxide-regression", version: "1", optionalDependencies: { [oxide]: "4.3.3" } },
      [`node_modules/${oxide}`]: {
        version: "4.3.3",
        dependencies,
        bundleDependencies: Object.keys(dependencies),
        cpu: ["wasm32"],
        optional: true,
        dev: true,
      },
      "node_modules/@emnapi/runtime": { version: "1.11.3" },
      "node_modules/tslib": { version: "2.8.1" },
    },
    (graph) => {
      for (const name of Object.keys(dependencies))
        expect(outgoing(graph, `node_modules/${oxide}`, name)).toMatchObject({
          status: "unresolved",
          selection: "selected",
        });
      expect(graph.nodes.filter((node) => !node.project)).toHaveLength(3);
      expect(graph.edges.find((edge) => edge.requested?.name === oxide)).toMatchObject({
        optional: true,
        selection: "conditional",
        condition: { language: "npm:platform/v1", expression: { cpu: ["wasm32"] } },
      });
    },
  );
});
