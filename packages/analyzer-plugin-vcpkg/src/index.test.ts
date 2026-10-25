import { join } from "node:path";
import { scanFixtures } from "@scatool/analyzer-test-utils";
import { extractor } from "./index.ts";
import { type VcpkgOptions } from "./options.ts";
import { test, expect } from "vite-plus/test";
import os, { tmpdir } from "node:os";
import { copyFile, rm, mkdtemp, readFile } from "node:fs/promises";
import type { VcpkgPort } from "./types.ts";
import { findExecutable, parseResult, runCommand } from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
const configs: { name: string; options: Partial<VcpkgOptions> }[] = [
  { name: "all-platforms/default-features", options: { includeAllFeatures: false } },
  { name: "all-platforms/all-features", options: { includeAllFeatures: true } },
  {
    name: "linux/default-features",
    options: {
      includeAllFeatures: false,
      targetPlatform: { targetArchitecture: "x64", cmakeSystemName: "Linux", isNative: true },
    },
  },
  {
    name: "linux/all-features",
    options: {
      includeAllFeatures: true,
      targetPlatform: { targetArchitecture: "x64", cmakeSystemName: "Linux", isNative: true },
    },
  },
];
const fixtures = await scanFixtures(fixturesDir, "*/vcpkg.json");
for (const fixture of fixtures) {
  for (const config of configs) {
    test(`native vcpkg registry declarations ${fixture}: ${config.name}`, async () => {
      const result = await extractor.extract(join(fixturesDir, fixture), config.options, {
        codebaseId: `fixture:${fixture}`,
      });
      expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
      expect(parseResult(result)).toEqual(result);
      expect(result.graphs).toHaveLength(1);
      const graph = result.graphs[0]!;
      expect(graph.interpretation).toBe("declared");
      expect(graph.rootCompleteness).toBe("complete");
      expect(graph.context?.["vcpkg:includeAllFeatures"]).toBe(config.options.includeAllFeatures);
      expect(graph.context?.["vcpkg:targetPlatform"]).toEqual(config.options.targetPlatform);
      expect(graph.roots.map((root) => root.scope).sort()).toEqual(["host", "target"]);
      const manifest = JSON.parse(
        await readFile(join(fixturesDir, fixture, "vcpkg.json"), "utf8"),
      ) as VcpkgPort;
      for (const root of graph.roots) {
        const node = graph.nodes.find((node) => node.id === root.node)!;
        expect(node.attributes?.["vcpkg:manifest"]).toEqual(manifest);
        const expected = (manifest.dependencies ?? []).filter(
          (dep) => (typeof dep !== "string" && dep.host === true) === (root.scope === "host"),
        );
        for (const dep of expected) {
          const name = typeof dep === "string" ? dep : dep.name;
          expect(
            graph.edges.some((edge) => edge.from === root.node && edge.requested?.name === name),
          ).toBe(true);
        }
      }
      for (const node of graph.nodes) {
        expect(node.variant?.enabledFeatures).toBeUndefined();
        expect(node.attributes?.["vcpkg:domain"]).toMatch(/^(host|target)$/);
        // Every observed native feature/platform record survives without platform filtering.
        const port = node.attributes?.["vcpkg:manifest"] as VcpkgPort;
        for (const [feature, definition] of Object.entries(port.features ?? {})) {
          for (const dependency of definition.dependencies ?? []) {
            const name = typeof dependency === "string" ? dependency : dependency.name;
            if (
              node.project &&
              (typeof dependency !== "string" && dependency.host === true) !==
                (node.attributes?.["vcpkg:domain"] === "host")
            )
              continue;
            expect(
              graph.edges.some(
                (edge) =>
                  edge.from === node.id &&
                  edge.requested?.name === name &&
                  (edge.condition?.expression as { feature?: string })?.feature === feature,
              ),
            ).toBe(true);
          }
        }
      }
      for (const edge of graph.edges) expect(edge.selection).toBe("unknown");
      expect(result.packages.length).toBeGreaterThan(0);
    }, 60000);
  }
}

// Preserve the existing independent native command comparison, but compare candidate coverage:
// registry declarations are a superset, not a claim of selected versions/features or exact closure.
const arch = os.arch() === "ia32" ? "x86" : os.arch();
const platform =
  os.platform() === "darwin" ? "osx" : os.platform() === "win32" ? "windows" : os.platform();
const triplet = `${arch}-${platform}`;
const vcpkgPath = findExecutable("vcpkg") || "vcpkg";
for (const fixture of fixtures) {
  test(`native selected dependencies are represented by registry candidates: ${fixture}`, async () => {
    const result = await extractor.extract(
      join(fixturesDir, fixture),
      {},
      { codebaseId: `fixture:${fixture}` },
    );
    expect(result.issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    const graph = result.graphs[0]!;
    const nodeNames = new Map(
      graph.nodes.map((node) => [node.id, PackageURL.fromString(node.purl).name]),
    );
    const names = new Set(result.packages.map((pkg) => PackageURL.fromString(pkg.purl).name));
    const dir = await mkdtemp(join(tmpdir(), "vcpkg-native-"));
    try {
      await copyFile(join(fixturesDir, fixture, "vcpkg.json"), join(dir, "vcpkg.json"));
      const dryRun = await runCommand(
        [vcpkgPath, "install", "--dry-run", `--triplet=${triplet}`, `--host-triplet=${triplet}`],
        { cwd: dir },
      );
      expect(dryRun.exitCode, dryRun.stderr).toBe(0);
      const selected = dryRun.stdout.split("\n").flatMap((line) => {
        const match = line
          .replace(/^\s*\*?\s*/, "")
          .trim()
          .match(/^([^:[]+)(\[[^\]]+\])?:([^@]+)@([^#\s]+)/);
        return match ? [match[1]!] : [];
      });
      expect(selected.length).toBeGreaterThan(0);
      for (const name of selected)
        expect(names.has(name), `missing native candidate ${name}`).toBe(true);
      const dependInfo = await runCommand(
        [
          vcpkgPath,
          "depend-info",
          `--triplet=${triplet}`,
          `--host-triplet=${triplet}`,
          "--format=list",
        ],
        { cwd: dir },
      );
      expect(dependInfo.exitCode, dependInfo.stderr).toBe(0);
      let inspected = 0;
      for (const line of dependInfo.stderr.split("\n")) {
        const match = line.match(/^([^:[]+)(\[[^\]]+\])?:([^@]*)/);
        if (!match || !names.has(match[1]!.trim())) continue;
        const from = match[1]!.trim();
        inspected++;
        for (const to of match[3]!
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)) {
          expect(
            graph.edges.some(
              (edge) =>
                edge.status === "resolved" &&
                nodeNames.get(edge.from) === from &&
                nodeNames.get(edge.to) === to,
            ),
            `${from} -> ${to}`,
          ).toBe(true);
        }
      }
      expect(inspected).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
}
