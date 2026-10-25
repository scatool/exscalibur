import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryDependencies } from "@scatool/analyzer-core";
import {
  requireAcceptedCase,
  sha256,
  validateAcceptanceLedger,
  validateAcceptedBaseline,
} from "./integration-acceptance.ts";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const config = read("test/repositories.json");
const ledger = JSON.parse(read("test/integration-migration.json"));

test("acceptance ledger covers exact configured pins, options and Java requirements", () => {
  expect(validateAcceptanceLedger(config, ledger)).toHaveLength(87);
});
test("ledger rejects missing, duplicate, repinned and reconfigured entries", () => {
  for (const mutate of [
    (value: typeof ledger) => value.cases.pop(),
    (value: typeof ledger) => value.summary.accepted++,
    (value: typeof ledger) =>
      (value.cases.find((entry: { status: string }) => entry.status === "accepted").pendingReason =
        { status: "blocked", reason: "Stale blocker" }),
    (value: typeof ledger) => value.cases.push(value.cases[0]),
    (value: typeof ledger) => (value.cases[0].commit = "0".repeat(40)),
    (value: typeof ledger) => (value.cases[0].configuration.extractorOptions = { changed: true }),
    (value: typeof ledger) => (value.cases[0].configuration.javaVersion = 99),
    (value: typeof ledger) => (value.cases[0].reviewEvidence = []),
  ]) {
    const value = structuredClone(ledger);
    mutate(value);
    expect(() => validateAcceptanceLedger(config, value)).toThrow();
  }
});
test("pending cases report their tracked pin without reading or changing baselines", () => {
  // Keep exercising the gate after the inventory has no pending cases. Even a
  // previously reviewed baseline cannot bypass an explicit pending status.
  const entry = {
    ...validateAcceptanceLedger(config, ledger)[0]!,
    status: "pending-source-review" as const,
  };
  expect(() => requireAcceptedCase(entry)).toThrow(
    `pending-source-review: ${entry.id}@${entry.commit}`,
  );
});
for (const entry of validateAcceptanceLedger(config, ledger).filter(
  (e) => e.status === "accepted",
)) {
  test(`${entry.id}: reviewed baseline hashes and source semantics`, () => {
    if (Array.isArray(entry.reviewEvidence)) throw new Error("Missing evidence");
    const evidence = entry.reviewEvidence;
    const baseline = read(entry.baseline.path);
    const review = read(evidence.review.path);
    const result = validateAcceptedBaseline(entry, baseline, review);
    expect(() => validateAcceptedBaseline(entry, baseline + " ", review)).toThrow(
      "baseline hash mismatch",
    );
    expect(() => validateAcceptedBaseline(entry, baseline, review + " ")).toThrow(
      "review hash mismatch",
    );
    const wrongCodebase = JSON.stringify({ ...result, codebase: "wrong" });
    expect(() =>
      validateAcceptedBaseline(
        { ...entry, baseline: { ...entry.baseline, acceptedSha256: sha256(wrongCodebase) } },
        wrongCodebase,
        review,
      ),
    ).toThrow("codebase mismatch");
    for (const file of evidence.source.files)
      expect(sha256(readFileSync(join(root, `test/repositories/${entry.id}/${file.path}`)))).toBe(
        file.sha256,
      );
    const disguisedLegacy = JSON.stringify({ ...result, relationships: [] });
    expect(() =>
      validateAcceptedBaseline(
        { ...entry, baseline: { ...entry.baseline, acceptedSha256: sha256(disguisedLegacy) } },
        disguisedLegacy,
        review,
      ),
    ).toThrow();
    if (
      evidence.kind !== "package-json-declarations" &&
      evidence.kind !== "package-json-workspace-declarations"
    )
      return;
    const manifests = evidence.source.files.filter(
      (file) => file.path === "package.json" || file.path.endsWith("/package.json"),
    );
    expect(new Set(manifests.map((file) => file.path)).size).toBe(manifests.length);
    if (evidence.kind === "package-json-declarations")
      expect(manifests.map((file) => file.path)).toEqual(["package.json"]);
    else expect(manifests.length).toBeGreaterThan(1);
    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.subprojects).toHaveLength(manifests.length);
    expect(result.graphs).toHaveLength(manifests.length);
    expect(
      result.graphs
        .map((graph) => graph.source.files)
        .flat()
        .sort(),
    ).toEqual(manifests.map((file) => file.path).sort());
    for (const file of manifests) {
      const manifest = JSON.parse(read(`test/repositories/${entry.id}/${file.path}`));
      const project = {
        purl: `pkg:npm/${manifest.name.replace(/^@/, "%40")}${manifest.version ? `@${manifest.version}` : ""}`,
        definitionFile: file.path,
      };
      expect(result.subprojects.filter((p) => p.definitionFile === file.path)).toHaveLength(1);
      expect(result.subprojects.find((p) => p.definitionFile === file.path)).toMatchObject(project);
      const graph = result.graphs.find(
        (graph) => graph.source.files.length === 1 && graph.source.files[0] === file.path,
      )!;
      expect(graph.source).toEqual({ extractor: "packagejson", files: [file.path] });
      expect(graph.interpretation).toBe("declared");
      expect(graph.rootCompleteness).toBe("complete");
      const scopes = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ];
      expect(graph.roots.map((r) => r.scope).sort()).toEqual(scopes.sort());
      expect(graph.nodes).toHaveLength(5);
      const rooted = new Set(graph.roots.map((r) => r.node));
      expect(
        graph.nodes.filter((n) => !rooted.has(n.id)).map((n) => n.dependencyCompleteness),
      ).toEqual(["unknown"]);
      expect(graph.edges.every((e) => rooted.has(e.from))).toBe(true);
      for (const scope of graph.roots) {
        expect(scope.project).toEqual(project);
        expect(graph.nodes.find((n) => n.id === scope.node)).toMatchObject({
          project,
          dependencyCompleteness: "complete",
        });
        const expected = Object.entries(manifest[scope.scope] ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        );
        const edges = graph.edges.filter((e) => e.from === scope.node);
        expect(
          edges
            .map((e) => [e.requested?.name, e.requested?.specifier])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ).toEqual(expected);
        for (const edge of edges) {
          expect(edge).toMatchObject({
            status: "declared",
            relation: "depends-on",
            kind: scope.scope,
            selection: "selected",
            optional: false,
            evidence: [file.path],
          });
          expect(edge).not.toHaveProperty("to");
          expect(edge).not.toHaveProperty("condition");
        }
        const closure = queryDependencies(result, { graph: graph.id, root: scope.id });
        expect(closure.definite).toEqual([]);
        expect(closure.conditional).toEqual([]);
        expect(closure.declarations).toHaveLength(expected.length);
        expect(closure.declarations.every((d) => d.applicability === "definite")).toBe(true);
        expect(closure.completeness).toBe(expected.length ? "unknown" : "complete");
      }
    }
  });
}
