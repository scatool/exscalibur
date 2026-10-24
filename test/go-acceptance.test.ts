import { parse as parseToml } from "smol-toml";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { parseResult, queryDependencies } from "@scatool/analyzer-core";
import { assertNativeNpmLock } from "./acceptance/native-npm-lock.ts";

const cases = ["sharkdp+bat", "ZEISS+htmx-template", "ory+kratos"];
const sorted = (values: unknown[]) =>
  values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, path) : entry.isFile() ? [path] : [];
  });
}
type Native = Record<string, any>;
const facts = (module: Native) => ({
  Path: module.Path,
  ...(module.Version !== undefined && { Version: module.Version }),
  ...(module.Indirect !== undefined && { Indirect: module.Indirect }),
  ...(module.Replace && {
    Replace: {
      Path: module.Replace.Path,
      ...(module.Replace.Version !== undefined && { Version: module.Replace.Version }),
    },
  }),
});
const purl = (path: string, version?: string) =>
  `pkg:golang/${encodeURIComponent(path)}${version ? `@${version}` : ""}`;
for (const id of cases)
  test(`${id}: native Go module membership, declarations and selected-owner adjacency`, () => {
    const root = join(import.meta.dirname, "repositories", id);
    const paths = files(root);
    const value = parseResult(
      JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
    );
    expect(value.graphs).toHaveLength(
      id === "sharkdp+bat" ? 5 : id === "ZEISS+htmx-template" ? 4 : 14,
    );
    const expectedIssues =
      id === "sharkdp+bat"
        ? [
            ["core.file_extraction_failed", "tests/syntax-tests/highlighted/Go/go.mod", "ERROR"],
            [
              "core.file_extraction_failed",
              "tests/syntax-tests/highlighted/Requirements.txt/requirements.txt",
              "ERROR",
            ],
            [
              "requirementstxt.option_preserved",
              "tests/syntax-tests/source/Requirements.txt/requirements.txt",
              "WARNING",
            ],
            [
              "requirementstxt.option_preserved",
              "tests/syntax-tests/source/Requirements.txt/requirements.txt",
              "WARNING",
            ],
            ["cargo.raw_lock_projection", "Cargo.lock", "HINT"],
          ]
        : (id === "ZEISS+htmx-template"
            ? ["package.json"]
            : ["package.json", "oryx/package.json"]
          ).map((file) => ["npm.manifest_lock_mismatch", file, "WARNING"]);
    expect(sorted(value.issues.map((i) => [i.code, i.file, i.severity]))).toEqual(
      sorted(expectedIssues),
    );
    expect(JSON.stringify(value)).not.toContain(root);
    expect(value.packages.map((p) => p.purl).sort()).toEqual(
      [
        ...new Set(
          value.graphs.flatMap((g) => g.nodes.filter((n) => !n.project).map((n) => n.purl)),
        ),
      ].sort(),
    );
    for (const graph of value.graphs.filter((g) => g.source.extractor === "packagejson")) {
      const file = graph.source.files[0]!;
      const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
      expect(graph.roots).toHaveLength(4);
      expect(graph.nodes).toHaveLength(5);
      expect(graph.interpretation).toBe("declared");
      let count = 0;
      for (const r of graph.roots) {
        expect(r.project.definitionFile).toBe(file);
        const expected = Object.entries(manifest[r.scope] ?? {});
        count += expected.length;
        const outgoing = graph.edges.filter((e) => e.from === r.node);
        expect(sorted(outgoing.map((e) => [e.requested?.name, e.requested?.specifier]))).toEqual(
          sorted(expected),
        );
        for (const e of outgoing) {
          expect(e.status).toBe("declared");
          expect(e).not.toHaveProperty("to");
        }
      }
      expect(graph.edges).toHaveLength(count);
    }
    const inputs = paths.filter((path) => path.endsWith("go.mod"));
    const graphs = value.graphs.filter((graph) => graph.source.extractor === "gomod");
    expect(graphs.map((graph) => graph.source.files[0]).sort()).toEqual(inputs.sort());
    for (const file of inputs) {
      const graph = graphs.find((graph) => graph.source.files[0] === file)!;
      const go = (...args: string[]) =>
        execFileSync("go", args, {
          cwd: dirname(join(root, file)),
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
      if (file.includes("/highlighted/")) {
        expect(() => go("mod", "edit", "-json")).toThrow();
        expect(graph).toMatchObject({
          interpretation: "unknown",
          rootCompleteness: "unknown",
          roots: [],
          nodes: [],
          edges: [],
        });
        expect(value.issues.filter((issue) => issue.file === file)).toEqual([
          expect.objectContaining({ code: "core.file_extraction_failed", severity: "ERROR" }),
        ]);
        continue;
      }
      const manifest = JSON.parse(go("mod", "edit", "-json"));
      const modules = JSON.parse(
        "[" + go("list", "-m", "-json", "all").replace(/}\s*{/g, "},{") + "]",
      ) as Native[];
      const rawGraph = go("mod", "graph");
      expect(graph.attributes?.["go:manifest"]).toEqual(manifest);
      expect(graph.attributes?.["go:moduleGraph"]).toBe(rawGraph);
      expect(graph).toMatchObject({ interpretation: "resolved", rootCompleteness: "complete" });
      expect(graph.roots.map((r) => r.scope).sort()).toEqual([
        "dependencies",
        "go:build-list",
        "indirectDependencies",
      ]);
      const project = { purl: purl(manifest.Module.Path), definitionFile: file };
      for (const r of graph.roots) expect(r.project).toEqual(project);
      const selected = new Map<string, Native>(
        modules.filter((m) => m.Path !== manifest.Module.Path).map((m) => [m.Path, m]),
      );
      const nodes = graph.nodes.filter((n) => !n.project);
      expect(nodes.map((n) => n.id).sort()).toEqual([...selected.keys()].sort());
      for (const node of nodes) {
        const native = selected.get(node.id)!;
        expect(node.purl).toBe(purl(native.Path, native.Version));
        expect(node.attributes?.["go:module"]).toEqual(facts(native));
        expect(node.dependencyCompleteness).toBe("unknown");
        if (native.Replace)
          expect(node.artifacts?.[0]).toMatchObject({
            location: native.Replace.Path,
            attributes: { "go:replacement": facts(native).Replace },
          });
        else expect(node.artifacts).toBeUndefined();
      }
      const build = graph.roots.find((r) => r.scope === "go:build-list")!;
      expect(
        sorted(
          graph.edges
            .filter((e) => e.from === build.node)
            .map((e) => [e.status, e.selection, e.status === "resolved" ? e.to : undefined]),
        ),
      ).toEqual(sorted([...selected.keys()].map((path) => ["resolved", "selected", path])));
      const expected: any[] = [];
      for (const req of manifest.Require ?? [])
        expected.push([
          `root:${req.Indirect ? "indirectDependencies" : "dependencies"}`,
          req.Path,
          req.Version,
        ]);
      const split = (x: string) => {
        const i = x.lastIndexOf("@");
        return i < 0 ? [x, ""] : [x.slice(0, i), x.slice(i + 1)];
      };
      for (const line of rawGraph.trim().split("\n")) {
        if (!line) continue;
        const [owner, target] = line.split(/\s+/);
        const [name, version] = split(owner!);
        const [dep, requested] = split(target!);
        if (
          ["go", "toolchain", manifest.Module.Path].includes(name) ||
          ["go", "toolchain"].includes(dep)
        )
          continue;
        const native = selected.get(name!);
        if (native && (native.Version ?? "") === version) expected.push([name, dep, requested]);
      }
      const requests = graph.edges.filter((e) => e.from !== build.node);
      expect(
        sorted(requests.map((e) => [e.from, e.requested?.name, e.requested?.specifier])),
      ).toEqual(sorted(expected));
      for (const edge of requests) {
        const target = selected.get(edge.requested!.name!);
        expect(edge.selection).toBe("selected");
        expect(edge.status).toBe(target ? "resolved" : "unresolved");
        if (edge.status === "resolved") expect(edge.to).toBe(target!.Path);
      }
      expect(graph.nodes).toHaveLength(selected.size + 3);
      expect(queryDependencies(value, { graph: graph.id, root: build.id }).completeness).toBe(
        selected.size ? "unknown" : "complete",
      );
    }
    for (const file of paths.filter((path) => path.endsWith("package-lock.json"))) {
      const manifestFile = file.replace("package-lock.json", "package.json");
      const graph = value.graphs.find(
        (g) => g.source.extractor === "packagelockjson" && g.source.files.includes(file),
      )!;
      expect(graph).toBeDefined();
      const identities = new Set(graph.nodes.filter((n) => !n.project).map((n) => n.purl));
      assertNativeNpmLock(
        {
          ...value,
          graphs: [graph],
          packages: value.packages.filter((p) => identities.has(p.purl)),
        },
        JSON.parse(readFileSync(join(root, file), "utf8")),
        JSON.parse(readFileSync(join(root, manifestFile), "utf8")),
        `${id}/${file}`,
        manifestFile,
      );
    }
  }, 180000);

test("Bat: native Cargo records and syntax-fixture requirements", () => {
  const id = "sharkdp+bat";
  const root = join(import.meta.dirname, "repositories", id);
  const value = parseResult(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
  );
  const native = parseToml(readFileSync(join(root, "Cargo.lock"), "utf8")) as Native;
  const graph = value.graphs.find((g) => g.source.extractor === "cargolock")!;
  expect(graph).toMatchObject({ rootCompleteness: "unknown", roots: [], interpretation: "locked" });
  expect(graph.attributes?.["cargo:document"]).toEqual(native);
  expect(graph.nodes).toHaveLength(native.package.length);
  let count = 0;
  for (const pkg of native.package) {
    const node = graph.nodes.find((n) => {
      const p = n.attributes?.["cargo:lockPackage"] as Native;
      return p.name === pkg.name && p.version === pkg.version && p.source === pkg.source;
    })!;
    expect(node).toBeDefined();
    expect(node.attributes?.["cargo:lockPackage"]).toEqual(pkg);
    expect(node.dependencyCompleteness).toBe("complete");
    expect(node.project).toBeUndefined();
    if (pkg.source) expect(node.purl).toBe(`pkg:cargo/${pkg.name}@${pkg.version}`);
    else {
      expect(node.purl).toMatch(/^pkg:generic\/cargo-local\//);
      expect(node.purl.endsWith(`@${pkg.version}`)).toBe(true);
    }
    if (pkg.checksum) expect(node.artifacts?.[0]?.hashes?.sha256).toBe(pkg.checksum);
    const outgoing = graph.edges.filter((e) => e.from === node.id);
    expect(outgoing).toHaveLength((pkg.dependencies ?? []).length);
    for (const ref of pkg.dependencies ?? []) {
      count++;
      const [name, version] = ref.split(" ");
      const candidates = native.package.filter(
        (p: Native) => p.name === name && (!version || p.version === version),
      );
      expect(candidates).toHaveLength(1);
      const edge = outgoing.find((e) => e.requested?.attributes?.["cargo:lockReference"] === ref)!;
      expect(edge).toMatchObject({ status: "resolved", selection: "selected" });
      if (edge.status === "resolved")
        expect(
          graph.nodes.find((n) => n.id === edge.to)?.attributes?.["cargo:lockPackage"],
        ).toEqual(candidates[0]);
    }
  }
  expect(graph.edges).toHaveLength(count);
});

test("Bat: requirements retain declarations, markers, unsupported options and malformed observation", () => {
  const id = "sharkdp+bat";
  const root = join(import.meta.dirname, "repositories", id);
  const value = parseResult(
    JSON.parse(readFileSync(join(import.meta.dirname, "__snapshots__", `${id}.json`), "utf8")),
  );
  const file = "tests/syntax-tests/source/Requirements.txt/requirements.txt";
  const lines = readFileSync(join(root, file), "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
  const options = lines.filter((l) => l.startsWith("--"));
  const requests = lines.filter((l) => !l.startsWith("--"));
  const graph = value.graphs.find((g) => g.source.files.includes(file))!;
  expect(graph.roots).toHaveLength(1);
  expect(graph.roots[0]!.project.definitionFile).toBe(file);
  expect(sorted(graph.edges.map((e) => e.requested?.specifier))).toEqual(sorted(requests));
  // Pinned line 25 uses valid PEP 508 whitespace before the extras list.
  const extrasDeclaration = 'requests [security,tests] >= 2.8.1, == 2.8.* ; python_version < "2.7"';
  expect(requests).toContain(extrasDeclaration);
  expect(graph.edges.find((edge) => edge.requested?.specifier === extrasDeclaration)).toMatchObject(
    {
      status: "declared",
      selection: "conditional",
      requested: { name: "requests", features: ["security", "tests"] },
      condition: { language: "pep508", expression: 'python_version < "2.7"' },
    },
  );
  for (const edge of graph.edges) {
    expect(edge.status).toBe("declared");
    expect(edge).not.toHaveProperty("to");
    expect(edge.evidence).toEqual([file]);
    const expression = edge.requested!.specifier!.split(";")[1]?.trim();
    expect(edge.selection).toBe(expression ? "conditional" : "selected");
    if (expression) expect(edge.condition).toEqual({ language: "pep508", expression });
  }
  const issues = value.issues.filter((i) => i.file === file);
  expect(issues).toHaveLength(options.length);
  for (const option of options)
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "requirementstxt.option_preserved",
        message: expect.stringContaining(option),
      }),
    );
  expect(queryDependencies(value, { graph: graph.id, root: graph.roots[0]!.id }).completeness).toBe(
    "unknown",
  );
  const failed = "tests/syntax-tests/highlighted/Requirements.txt/requirements.txt";
  expect(value.graphs.find((g) => g.source.files.includes(failed))).toMatchObject({
    interpretation: "unknown",
    rootCompleteness: "unknown",
    roots: [],
    nodes: [],
    edges: [],
  });
  expect(value.issues.filter((i) => i.file === failed)).toEqual([
    expect.objectContaining({ code: "core.file_extraction_failed", severity: "ERROR" }),
  ]);
});
