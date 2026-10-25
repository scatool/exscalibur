import { dirname, join } from "node:path/posix";
import { expect } from "vite-plus/test";
import type { DependencyGraph } from "@scatool/analyzer-core";

const descriptorName = (value: string) =>
  value.slice(0, value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0));

/** Check the reviewed fixture policies directly, without using the extractor's matcher.
 * These pins use global names, exact request descriptions and one named issuer.
 * This is deliberately not a general Yarn resolver or a replacement for native oracles.
 */
export function checkYarnBindingUncertainty(
  graph: DependencyGraph,
  source: (path: string) => string,
  descriptors: Iterable<string>,
): Set<string> {
  const lockfile = graph.source.files.find((file) => file.endsWith("yarn.lock"))!;
  const policyFile = join(dirname(lockfile), "package.json");
  const manifest = JSON.parse(source(policyFile));
  const resolutions = (manifest.resolutions ?? {}) as Record<string, string>;
  const patterns = [...descriptors].filter((descriptor) => descriptor.includes("@patch:"));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const uncertainNodes = new Set<string>();

  for (const [selector, target] of Object.entries(resolutions)) {
    expect(selector).not.toBe("");
    expect(typeof target).toBe("string");
  }

  for (const edge of graph.edges) {
    const actual = edge.attributes?.["yarn:bindingUncertainty"];
    if (edge.kind === "peerDependencies" || edge.selection === "excluded") {
      expect(actual).toBeUndefined();
      continue;
    }

    const name = edge.requested!.name!;
    const request = edge.requested!.specifier!.replace(/^npm:/, "");
    const owner = nodes.get(edge.from)!;
    const issuer = owner.locator
      ? descriptorName(owner.locator)
      : JSON.parse(source(owner.project!.definitionFile)).name;
    const resolution = Object.keys(resolutions).find((selector) =>
      [name, `${name}@${request}`, `${issuer}/${name}`].includes(selector),
    );

    // The descriptor key itself records this built-in compatibility alternative.
    // Explicit/manual patches are not proof that unrelated requests are rewritten.
    const patches = patterns.filter((selector) => {
      const prefix = `${name}@patch:`;
      if (!selector.startsWith(prefix)) return false;
      const [wrapped, fragment] = selector.slice(prefix.length).split("#");
      return (
        [`${name}@${request}`, `${name}@npm:${request}`].includes(decodeURIComponent(wrapped!)) &&
        [`optional!builtin<compat/${name}>`, `~builtin<compat/${name}>`].includes(fragment!)
      );
    });
    const expected = resolution
      ? { reason: "unapplied-resolution", selectors: [resolution] }
      : patches.length
        ? { reason: "patch-alternative", selectors: patches }
        : undefined;

    // Check both directions: an affected request needs a guard, while an
    // unrelated request must not gain one merely because a policy exists.
    expect(actual).toEqual(expected);
    if (!expected) continue;

    expect(edge.selection).toBe("unknown");
    expect(owner.dependencyCompleteness).toBe("unknown");
    uncertainNodes.add(owner.id);
    if (resolution) {
      expect(edge.evidence).toContain(policyFile);
      expect(owner.evidence).toContain(policyFile);
    }
  }

  // In these reviewed Berry fixtures, unknown node coverage must be explained
  // by an affected outgoing binding. Classic has separate preexisting limits.
  if (graph.source.extractor === "yarnberry")
    for (const node of graph.nodes)
      if (node.dependencyCompleteness === "unknown") expect(uncertainNodes.has(node.id)).toBe(true);

  return uncertainNodes;
}
