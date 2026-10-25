import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { parse as yaml } from "yaml";
import { parse as jsonc } from "jsonc-parser";
import { expect } from "vite-plus/test";
import type { AnalyzerResult } from "@scatool/analyzer-core";

const classic = createRequire(import.meta.url)(
  "@yarnpkg/lockfile",
) as typeof import("@yarnpkg/lockfile");
type RecordValue = Record<string, any>;
const scopes = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const sorted = (values: unknown[]) =>
  [...new Set(values.map((value) => JSON.stringify(value)))].sort((a, b) => a.localeCompare(b));

/** Compare retained native records with fixture inputs, independently of old PURL-union snapshots. */
export async function assertNativeFixture(kind: string, result: AnalyzerResult, directory: string) {
  const graphs = result.graphs.filter(
    (graph) =>
      graph.source.extractor === kind &&
      (kind !== "denolock" || graph.interpretation === "locked") &&
      (!["yarnlock", "yarnberry"].includes(kind) ||
        graph.attributes?.["yarn:observation"] === "native-lock"),
  );
  expect(graphs.length).toBeGreaterThan(0);
  for (const graph of graphs) {
    const file = graph.source.files.find((file) =>
      kind === "packagejson"
        ? file.endsWith("package.json")
        : kind === "packagelockjson"
          ? /(?:package-lock|npm-shrinkwrap)\.json$/.test(file)
          : kind === "pnpmlock"
            ? file.endsWith("pnpm-lock.yaml")
            : kind === "bunlock"
              ? file.endsWith("bun.lock")
              : kind === "denolock"
                ? file.endsWith("deno.lock")
                : file.endsWith("yarn.lock"),
    );
    expect(file).toBeDefined();
    const content = await readFile(join(directory, file!), "utf8");
    const nodes = graph.nodes;
    if (kind === "packagejson") {
      const manifest = JSON.parse(content) as RecordValue;
      expect(graph.roots.map((root) => root.scope).sort((a, b) => a.localeCompare(b))).toEqual(
        [...scopes].sort((a, b) => a.localeCompare(b)),
      );
      for (const root of graph.roots) {
        const actual = graph.edges.filter((edge) => edge.from === root.node);
        expect(actual.every((edge) => edge.status === "declared")).toBe(true);
        expect(
          Object.fromEntries(
            actual.map((edge) => [edge.requested!.name, edge.requested!.specifier]),
          ),
        ).toEqual(manifest[root.scope] ?? {});
      }
    } else if (kind === "packagelockjson") {
      const lock = JSON.parse(content) as RecordValue;
      const locations: string[] = [];
      const records = new Map<string, RecordValue>();
      if (lock.lockfileVersion === 1) {
        const visit = (deps: RecordValue, parent: string) => {
          for (const [name, record] of Object.entries(deps)) {
            const location = `${parent ? `${parent}/` : ""}node_modules/${name}`;
            locations.push(location);
            records.set(location, { dependencies: record.requires ?? {} });
            visit(record.dependencies ?? {}, location);
          }
        };
        visit(lock.dependencies ?? {}, "");
      } else {
        for (const [location, record] of Object.entries(lock.packages) as [string, RecordValue][])
          if (location.split("/").includes("node_modules") && record.link !== true) {
            locations.push(location);
            records.set(location, record);
          }
      }
      expect(
        nodes
          .filter((node) => node.id.startsWith("package:"))
          .map((node) => node.locator)
          .sort((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(locations.sort((a, b) => String(a).localeCompare(String(b))));
      for (const [location, record] of records) {
        const node = nodes.find((node) => node.locator === location)!;
        const expected = scopes.flatMap((scope) =>
          Object.entries(record[scope] ?? {}).map(([name, specifier]) => [scope, name, specifier]),
        );
        const actual = graph.edges
          .filter((edge) => edge.from === node.id)
          .map((edge) => [edge.kind, edge.requested?.name, edge.requested?.specifier]);
        expect(sorted(actual), location).toEqual(sorted(expected));
      }
      for (const root of graph.roots) {
        const projectNode = nodes.find(
          (node) =>
            node.project?.definitionFile === root.project.definitionFile &&
            node.locator !== undefined,
        )!;
        const record =
          lock.lockfileVersion === 1
            ? JSON.parse(await readFile(join(directory, root.project.definitionFile), "utf8"))
            : lock.packages[projectNode.locator!];
        expect(
          sorted(
            graph.edges
              .filter((edge) => edge.from === root.node)
              .map((edge) => [edge.requested?.name, edge.requested?.specifier]),
          ),
        ).toEqual(sorted(Object.entries(record[root.scope] ?? {})));
      }
    } else if (kind === "pnpmlock") {
      const lock = yaml(content) as RecordValue;
      const expected = Object.keys(lock.snapshots ?? lock.packages ?? {});
      const retained = nodes.map((node) => node.attributes?.["pnpm:snapshotKey"]);
      for (const key of expected) {
        expect(retained).toContain(key);
        const node = nodes.find((node) => node.attributes?.["pnpm:snapshotKey"] === key)!;
        const snapshot = (lock.snapshots ?? lock.packages)[key];
        const expectedBindings = scopes
          .filter((scope) => scope !== "peerDependencies")
          .flatMap((scope) =>
            Object.entries(snapshot[scope] ?? {}).map(([name, ref]) => [
              scope,
              name,
              typeof ref === "string" ? ref : (ref as RecordValue).version,
            ]),
          );
        const actualBindings = graph.edges
          .filter(
            (edge) => edge.from === node.id && edge.attributes?.["pnpm:bindingScope"] !== undefined,
          )
          .map((edge) => [
            edge.attributes!["pnpm:bindingScope"],
            edge.requested?.name,
            edge.attributes!["pnpm:dependencyReference"],
          ]);
        expect(sorted(actualBindings), key).toEqual(sorted(expectedBindings));
      }
      for (const root of graph.roots) {
        const projectNode = nodes.find(
          (node) =>
            node.project?.definitionFile === root.project.definitionFile &&
            node.locator !== undefined,
        )!;
        const importer = lock.importers?.[projectNode.locator!] ?? lock;
        const expectedBindings = Object.entries(importer[root.scope] ?? {}).map(([name, ref]) => [
          name,
          typeof ref === "string" ? ref : (ref as RecordValue).version,
        ]);
        expect(
          sorted(
            graph.edges
              .filter((edge) => edge.from === root.node)
              .map((edge) => [edge.requested?.name, edge.attributes?.["pnpm:dependencyReference"]]),
          ),
        ).toEqual(sorted(expectedBindings));
      }
    } else if (kind === "bunlock") {
      const lock = jsonc(content) as RecordValue;
      for (const [key, tuple] of Object.entries(lock.packages ?? {}))
        expect(nodes.find((node) => node.locator === key)?.attributes?.["bun:tuple"]).toEqual(
          tuple,
        );
      expect(nodes.filter((node) => node.attributes?.["bun:tuple"] !== undefined)).toHaveLength(
        Object.keys(lock.packages ?? {}).length,
      );
    } else if (kind === "denolock") {
      const lock = JSON.parse(content) as RecordValue;
      const tables = String(lock.version) === "3" ? lock.packages : lock;
      for (const ecosystem of ["npm", "jsr"])
        for (const [key, record] of Object.entries(tables[ecosystem] ?? {}))
          expect(
            nodes.find((node) => node.id === `${ecosystem}:${JSON.stringify(key)}`)?.attributes?.[
              "deno:record"
            ],
          ).toEqual(record);
      for (const [url, integrity] of Object.entries(lock.remote ?? {}))
        expect(nodes.find((node) => node.locator === url)?.attributes?.["deno:record"]).toEqual({
          url,
          integrity,
        });
    } else {
      // Classic's parser emits individual descriptors; Berry stores comma-separated descriptor groups.
      const records = kind === "yarnlock" ? classic.parse(content).object : yaml(content);
      const expected = Object.keys(records)
        .filter((key) => key !== "__metadata")
        .flatMap((key) => (kind === "yarnlock" ? [key] : key.split(/,\s+/)));
      for (const [key, record] of Object.entries(records) as [string, RecordValue][]) {
        if (key === "__metadata") continue;
        const descriptor = kind === "yarnlock" ? key : key.split(/,\s+/)[0]!;
        const node = nodes.find((node) =>
          (node.attributes?.["yarn:descriptors"] as string[] | undefined)?.includes(descriptor),
        )!;
        const expectedRequests = [
          "dependencies",
          "optionalDependencies",
          "peerDependencies",
        ].flatMap((scope) => Object.entries(record[scope] ?? {}));
        expect(
          sorted(
            graph.edges
              .filter((edge) => edge.from === node.id)
              .map((edge) => [edge.requested?.name, edge.requested?.specifier]),
          ),
          descriptor,
        ).toEqual(sorted(expectedRequests));
      }
      const actual = nodes.flatMap(
        (node) => (node.attributes?.["yarn:descriptors"] ?? []) as string[],
      );
      expect([...new Set(actual)].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
        [...new Set(expected)].sort((a, b) => String(a).localeCompare(String(b))),
      );
    }
  }
}
