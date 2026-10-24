import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { validateResultV2 } from "@scatool/analyzer-core";
import { extractorV2 } from "./index-v2.ts";

type Fixture = { id: string; packages: Record<string, Record<string, unknown>> };
type NativeEdge = {
  from: string;
  name: string;
  rawSpec: string;
  spec: string;
  type: string;
  peer: boolean;
  optional: boolean;
  to: string | null;
  valid: boolean;
  error: string | null;
};
const directory = join(import.meta.dirname, "__fixtures__", "npm-peer-oracle");
const inputBytes = await readFile(join(directory, "inputs.json"));
const fixtures = JSON.parse(inputBytes.toString("utf8")) as Fixture[];
const native = JSON.parse(await readFile(join(directory, "native-output.json"), "utf8")) as {
  versions: { node: string; npm: string; arborist: string };
  inputSha256: string;
  observations: Array<{ id: string; loadVirtual: NativeEdge[]; loadActual: NativeEdge[] }>;
};

test("native peer capture identifies its exact inputs, tools, and case set", () => {
  expect(native.versions).toEqual({ node: "22.23.4", npm: "11.9.0", arborist: "9.2.0" });
  expect(native.inputSha256).toBe(createHash("sha256").update(inputBytes).digest("hex"));
  expect(native.observations.map((entry) => entry.id)).toEqual(fixtures.map((entry) => entry.id));
  expect(fixtures).toHaveLength(9);
  const expectedErrors: Record<string, Array<string | null>> = {
    "hoisted-valid": [null],
    "nested-valid": [null, null],
    "hoisted-conflict": ["INVALID"],
    "optional-present": [null],
    "optional-absent": [null],
    "required-absent": ["MISSING"],
    "child-candidate-invalid": ["PEER LOCAL"],
    "optional-conflict": ["INVALID"],
    "root-peer-valid": [null],
  };
  for (const observation of native.observations) {
    // Separate native reads of controlled virtual and installed-manifest trees agree here.
    expect(observation.loadActual).toEqual(observation.loadVirtual);
    const peers = observation.loadVirtual.filter((edge) => edge.peer);
    expect(peers.map((edge) => edge.error)).toEqual(expectedErrors[observation.id]);
    for (const peer of peers) expect(peer.valid).toBe(peer.error === null);
  }
});

test.each(fixtures)(
  "$id retains native peer candidates without claiming valid installation",
  async (fixture) => {
    const temporary = await mkdtemp(join(tmpdir(), "excalibur-peer-capture-"));
    try {
      await writeFile(join(temporary, "package.json"), JSON.stringify(fixture.packages[""]));
      await writeFile(
        join(temporary, "package-lock.json"),
        JSON.stringify({ ...fixture.packages[""], lockfileVersion: 3, packages: fixture.packages }),
      );
      const result = await extractorV2.extract(temporary, undefined, {
        codebaseId: "test:npm-peer-oracle",
      });
      validateResultV2(result);
      expect(result.graphs).toHaveLength(1);
      const graph = result.graphs[0]!;
      const expectedPeers = native.observations
        .find((item) => item.id === fixture.id)!
        .loadVirtual.filter((edge) => edge.peer);
      const peerEdges = graph.edges.filter((edge) => edge.kind === "peerDependencies");
      // Root projects have both a consumer view and an exact peer-scope root.
      expect(peerEdges).toHaveLength(
        expectedPeers.reduce((count, edge) => count + (edge.from === "" ? 2 : 1), 0),
      );
      for (const expected of expectedPeers) {
        const from = graph.nodes.find((node) => node.locator === expected.from)!;
        expect(from).toBeDefined();
        const bindings = peerEdges.filter(
          (edge) =>
            edge.from === from.id ||
            (expected.from === "" &&
              graph.roots.some(
                (root) => root.scope === "peerDependencies" && root.node === edge.from,
              )),
        );
        expect(bindings).toHaveLength(expected.from === "" ? 2 : 1);
        for (const edge of bindings) {
          expect(edge.requested).toMatchObject({
            name: expected.name,
            specifier: expected.rawSpec,
          });
          expect(edge.optional).toBe(expected.optional);
          expect(edge.selection).toBe(
            expected.optional && expected.to === null ? "excluded" : "unknown",
          );
          expect(edge.attributes?.["npm:peerBinding"]).toBe(
            expected.to === null ? "not-reported" : "lookup-candidate",
          );
          if (expected.to === null) {
            expect(edge.status).toBe("declared");
            expect("to" in edge).toBe(false);
          } else {
            expect(edge.status).toBe("resolved");
            expect(graph.nodes.find((node) => node.id === edge.to)?.locator).toBe(expected.to);
          }
        }
      }
      // Captured INVALID/PEER LOCAL/MISSING diagnostics belong to the native oracle.
      // The adapter currently reports uncertainty, not npm peer validity diagnostics.
      expect(result.issues).toEqual([]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
