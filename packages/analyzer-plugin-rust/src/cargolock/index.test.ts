import { join } from "node:path/posix";
import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { expect } from "vite-plus/test";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/Cargo.lock",
  assertResult: async (result, fixture) => {
    const input = parse(await readFile(join(fixturesDir, fixture, "Cargo.lock"), "utf8"));
    const graph = result.graphs[0]!;
    expect(result.graphs).toHaveLength(1);
    const observed = graph.nodes
      .filter((node) => node.attributes?.["cargo:lockPackage"] !== undefined)
      .map((node) => node.attributes!["cargo:lockPackage"]);
    const expected = [
      ...(Array.isArray(input.package) ? input.package : []),
      ...(input.root ? [input.root] : []),
    ];
    expect(observed).toHaveLength(expected.length);
    for (const record of expected) {
      expect(observed).toContainEqual(record);
      const native = record as {
        name: string;
        version: string;
        source?: string;
        dependencies?: string[];
        replace?: string;
      };
      const node = graph.nodes.find((node) => {
        const value = node.attributes?.["cargo:lockPackage"] as typeof native | undefined;
        return (
          value?.name === native.name &&
          value.version === native.version &&
          value.source === native.source
        );
      })!;
      const outgoing = graph.edges.filter((edge) => edge.from === node.id);
      expect(
        outgoing
          .filter((edge) => edge.relation === "depends-on")
          .map((edge) => {
            const reference = edge.requested?.attributes?.["cargo:lockReference"];
            expect(typeof reference).toBe("string");
            return reference as string;
          })
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual([...(native.dependencies ?? [])].sort((a, b) => a.localeCompare(b)));
      expect(
        outgoing
          .filter((edge) => edge.relation === "constrains")
          .map((edge) => edge.requested?.attributes?.["cargo:lockReference"]),
      ).toEqual(native.replace ? [native.replace] : []);
    }
    // A lock inventory alone cannot establish workspace scopes or activated features.
    if (!input.root) {
      expect(graph.roots).toEqual([]);
      expect(graph.rootCompleteness).toBe("unknown");
    }
    expect(graph.attributes?.["cargo:effectiveFeatureResolution"]).toBe("not-observed");
  },
});
