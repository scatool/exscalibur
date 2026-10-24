import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2, type AnalyzerResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

const registry = "registry+https://github.com/rust-lang/crates.io-index";
async function input(content: string, run: (result: AnalyzerResultV2) => void, failed = false) {
  const directory = await mkdtemp(join(tmpdir(), "excalibur-cargo-v2-"));
  try {
    await writeFile(join(directory, "Cargo.lock"), content);
    const result = await extractorV2.extract(directory, undefined, {
      codebaseId: "example:cargo-lock",
    });
    validateResultV2(result);
    expect(result.issues.some((issue) => issue.code === "core.file_extraction_failed")).toBe(
      failed,
    );
    run(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const entry = (name: string, version: string, source?: string, extra = "") =>
  `[[package]]\nname = ${JSON.stringify(name)}\nversion = ${JSON.stringify(version)}\n${source === undefined ? "" : `source = ${JSON.stringify(source)}\n`}${extra}\n`;

test("legacy root and metadata checksum preserve native subject ownership and artifact provenance", async () => {
  const checksum = "a".repeat(64);
  await input(
    `[root]\nname = "app"\nversion = "1.0.0"\ndependencies = ["child 1.0.0 (${registry})"]\n${entry("child", "1.0.0", registry)}[metadata]\n"checksum child 1.0.0 (${registry})" = "${checksum}"\n`,
    (result) => {
      expect(result.subprojects[0]!.definitionFile).toBe("Cargo.lock#root");
      expect(result.subprojects[0]!.attributes!["cargo:projectSource"]).toBe("lock.root");
      expect(result.graphs[0]!.roots[0]!.scope).toBe("cargo:locked-dependencies");
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:cargo/child@1.0.0")!.artifacts![0]!.hashes,
      ).toEqual({ sha256: checksum });
      expect(result.graphs[0]!.attributes!["cargo:reportedLockVersion"]).toBeNull();
    },
  );
});

test("source-less packages do not invent workspace membership or scopes", async () => {
  await input(entry("local", "1.0.0"), (result) => {
    expect(result.subprojects).toEqual([]);
    expect(result.graphs[0]!.roots).toEqual([]);
    expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
    expect(result.packages[0]!.purl).toMatch(/^pkg:generic\/cargo-local\//);
  });
});

test("source-less references prefer a path package only after a unique version is established", async () => {
  await input(
    entry("app", "1.0.0", undefined, 'dependencies = ["same 1.0.0"]') +
      entry("same", "1.0.0") +
      entry("same", "1.0.0", registry),
    (result) => {
      const graph = result.graphs[0]!,
        target = graph.nodes.find((node) => node.id === graph.edges[0]!.to)!;
      expect(target.attributes!["cargo:lockPackage"]).not.toHaveProperty("source");
      expect(result.packages).toHaveLength(3);
    },
  );
});

test("a bare dependency cannot select a local version over another version", async () => {
  await input(
    entry("app", "1.0.0", undefined, 'dependencies = ["same"]') +
      entry("same", "1.0.0") +
      entry("same", "2.0.0", registry),
    (result) => {
      expect(result.graphs[0]!.edges[0]).toMatchObject({
        status: "unresolved",
        requested: { name: "same" },
      });
      expect(result.issues.some((issue) => issue.code === "cargo.unresolved_lock_reference")).toBe(
        true,
      );
    },
  );
});

test("equal versions at different registries require explicit source evidence", async () => {
  await input(
    entry("app", "1.0.0", undefined, `dependencies = ["same 1.0.0", "same 1.0.0 (${registry})"]`) +
      entry("same", "1.0.0", registry) +
      entry("same", "1.0.0", "registry+https://example.com/index"),
    (result) => {
      const edges = result.graphs[0]!.edges;
      expect(edges.filter((edge) => edge.status === "unresolved")).toHaveLength(1);
      const bound = edges.find((edge) => edge.status === "resolved")!;
      expect(result.graphs[0]!.nodes.find((node) => node.id === bound.to)!.purl).toBe(
        "pkg:cargo/same@1.0.0",
      );
      expect(bound.requested!.specifier).toBeUndefined();
    },
  );
});

test.each([1, 2, 3, 4])(
  "explicit format %s preserves exact Git revision/query source distinctions",
  async (version) => {
    await input(
      `version = ${version}\n` +
        entry("same", "1.0.0", "git+https://example.com/repo?branch=topic%2Fone#abc") +
        entry("same", "1.0.0", "git+https://example.com/repo?branch=topic%2Fone#def"),
      (result) => {
        expect(new Set(result.packages.map((pkg) => pkg.purl)).size).toBe(2);
        expect(result.packages.every((pkg) => pkg.purl.includes("cargo_source="))).toBe(true);
        expect(result.graphs[0]!.nodes.every((node) => node.variant === undefined)).toBe(true);
      },
    );
  },
);

test("unused patches stay inventory and replacements never introduce ordinary reachability", async () => {
  await input(
    entry("app", "1.0.0", undefined, 'replace = "replacement 2.0.0"') +
      entry("replacement", "2.0.0", registry) +
      '[[patch.unused]]\nname = "unused"\nversion = "9.0.0"\nsource = "registry+https://example.com/index"\n',
    (result) => {
      const graph = result.graphs[0]!;
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ relation: "constrains", kind: "cargo:replace" });
      const unused = graph.nodes.find((node) => node.attributes?.["cargo:unusedPatch"] === true)!;
      expect(unused.dependencyCompleteness).toBe("unknown");
      expect(graph.edges.some((edge) => edge.to === unused.id)).toBe(false);
    },
  );
});

test("mixed legacy and inline hashes remain explicit observations; none is not a hash", async () => {
  const inline = "a".repeat(64),
    legacy = "b".repeat(64);
  await input(
    entry("child", "1.0.0", registry, `checksum = "${inline}"`) +
      entry("absent", "1.0.0", registry) +
      `[metadata]\n"checksum child 1.0.0 (${registry})" = "${legacy}"\n"checksum absent 1.0.0 (${registry})" = "<none>"\n`,
    (result) => {
      expect(result.issues.some((issue) => issue.code === "cargo.mixed_checksum_formats")).toBe(
        true,
      );
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:cargo/child@1.0.0")!.artifacts,
      ).toHaveLength(2);
      expect(
        result.packages.find((pkg) => pkg.purl === "pkg:cargo/absent@1.0.0")!.artifacts,
      ).toBeUndefined();
    },
  );
});

test("invalid checksums remain raw metadata without fabricated normalized hashes", async () => {
  await input(entry("child", "1.0.0", registry, 'checksum = "not-a-sha256"'), (result) => {
    expect(result.packages[0]!.artifacts).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "cargo.invalid_checksum")).toBe(true);
  });
});

test("unsupported formats and duplicate identities retain failed-file unknown coverage", async () => {
  for (const content of [
    "version = 999\n",
    entry("same", "1.0.0", registry) + entry("same", "1.0.0", registry),
  ]) {
    await input(
      content,
      (result) => {
        expect(result.graphs[0]!.rootCompleteness).toBe("unknown");
      },
      true,
    );
  }
});
