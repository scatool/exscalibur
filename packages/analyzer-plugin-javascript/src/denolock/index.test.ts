import { join } from "node:path/posix";
import { expect } from "vite-plus/test";
import { extractor } from "./index.ts";
import { createExtractorTests } from "@scatool/analyzer-test-utils";
import { assertNativeFixture } from "../fixture-assertions.ts";

const fixturesDir = join(import.meta.dirname, "__fixtures__");
await createExtractorTests({
  extractor,
  fixturesDir,
  pattern: "*/deno.lock",
  assertResult: async (result, fixture) => {
    await assertNativeFixture("denolock", result, join(fixturesDir, fixture));
    if (fixture !== "basic") return;

    // The v3 lock records two package links but no workspace root. The current
    // imports remain independent declarations, not resolved lockfile bindings.
    const locked = result.graphs.find((graph) => graph.source.key === "native-lock")!;
    const declarations = result.graphs.find(
      (graph) => graph.source.key === "current-config-declarations",
    )!;
    expect(locked.roots).toEqual([]);
    expect(locked.rootCompleteness).toBe("unknown");
    expect(
      locked.edges.map((edge) => ({
        from: locked.nodes.find((node) => node.id === edge.from)!.locator,
        to: locked.nodes.find((node) => node.id === edge.to)!.locator,
        status: edge.status,
        selection: edge.selection,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          from: "fast-check@3.13.1",
          to: "pure-rand@6.0.4",
          status: "resolved",
          selection: "selected",
        },
        {
          from: "@std/assert@1.0.9",
          to: "@std/fmt@0.218.2",
          status: "resolved",
          selection: "selected",
        },
      ]),
    );
    expect(locked.edges).toHaveLength(2);

    expect(declarations.edges).toHaveLength(2);
    expect(declarations.edges.every((edge) => edge.status === "declared")).toBe(true);
    expect(
      Object.fromEntries(
        declarations.edges.map((edge) => [edge.requested!.name, edge.requested!.specifier]),
      ),
    ).toEqual({
      "@std/assert": "jsr:@std/assert@^1.0.9",
      "fast-check": "npm:fast-check@^3.13.1",
    });
  },
});
