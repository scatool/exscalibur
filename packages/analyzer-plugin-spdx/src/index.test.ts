import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { parse as parseYaml } from "yaml";
import { PackageURL } from "packageurl-js";
import { validateResult } from "@scatool/analyzer-core";
import { extractSpdx } from "./index.ts";

const fixtures = join(import.meta.dirname, "__fixtures__");
for (const file of await readdir(fixtures)) {
  test(`native SPDX fixture: ${file}`, async () => {
    const content = await readFile(join(fixtures, file), "utf8");
    const source = parseYaml(content);
    const result = extractSpdx(content, { evidenceFile: file, codebase: "fixture" });
    validateResult(result);
    const elements = source.element ?? source["@graph"] ?? [];
    const graph = result.graphs[0]!;
    for (const element of elements) {
      const rawPurl =
        element.packageUrl ??
        element.software_packageUrl ??
        element.externalIdentifier?.find((item: { externalIdentifierType?: string }) =>
          item.externalIdentifierType?.endsWith("packageUrl"),
        )?.identifier;
      if (rawPurl) {
        let purl: string;
        try {
          purl = PackageURL.fromString(rawPurl).toString();
        } catch {
          continue;
        }
        expect(result.packages.some((pkg) => pkg.purl === purl)).toBe(true);
      }
      if (
        ["dependsOn", "hasOptionalDependency", "hasProvidedDependency"].includes(
          element.relationshipType,
        )
      ) {
        for (const target of element.to ?? []) {
          expect(
            graph.edges.some(
              (edge) =>
                edge.status === "resolved" &&
                graph.nodes.find((node) => node.id === edge.from)?.locator === element.from &&
                graph.nodes.find((node) => node.id === edge.to)?.locator === target &&
                edge.kind === element.relationshipType,
            ),
          ).toBe(true);
        }
      }
    }
    // Missing native PURLs must retain source entities rather than silently dropping them.
    const packages = elements.filter((element: Record<string, unknown>) =>
      String(element.type ?? element["@type"]).endsWith("Package"),
    );
    for (const pkg of packages)
      expect(
        graph.nodes.some((node) => node.locator === (pkg.spdxId ?? pkg["@id"])) ||
          result.subprojects.some(
            (project) => project.attributes?.["spdx:subject"] === (pkg.spdxId ?? pkg["@id"]),
          ),
      ).toBe(true);
  });
}

const versionTestFile = "version-test.spdx.json";

function createVersionTestDocument(specVersion?: unknown): string {
  return JSON.stringify({
    type: "SpdxDocument",
    spdxId: "https://example.com/spdx/version-test",
    creationInfo: { specVersion },
    rootElement: [],
    element: [
      {
        type: "software_Package",
        spdxId: "https://example.com/spdx/version-test/Package/example",
        packageUrl: "pkg:npm/example@1.0.0",
      },
    ],
  });
}

describe("SPDX version support", () => {
  test.each(["3.0.0", "3.0.1", "3.1.0", "3.999.0", "3.0.0-rc.1", "3.1.0-rc.1", "3.2.4+vendor.1"])(
    "extracts dependencies from SPDX %s",
    (specVersion) => {
      const result = extractSpdx(createVersionTestDocument(specVersion), {
        evidenceFile: versionTestFile,
        codebase: "fixture",
      });

      expect(result.issues).toEqual([]);
      expect(result.packages.map((pkg) => pkg.purl)).toEqual(["pkg:npm/example@1.0.0"]);
      validateResult(result);
    },
  );

  test.each(["2.3.0", "4.0.0", "3.0", "3.00.1", "not-a-version", 3, null, undefined])(
    "rejects unsupported or malformed SPDX version %s",
    (version) => {
      expect(() =>
        extractSpdx(createVersionTestDocument(version), {
          evidenceFile: versionTestFile,
          codebase: "fixture",
        }),
      ).toThrow();
    },
  );
});

test("default converter retains SPDX artifact locations and source references", async () => {
  const result = extractSpdx(await readFile(join(fixtures, "basic.spdx.json"), "utf8"), {
    evidenceFile: "basic.spdx.json",
    codebase: "fixture",
  });
  const express = result.packages.find((pkg) => pkg.purl === "pkg:npm/express@4.18.2")!;
  expect(express.artifacts).toContainEqual({
    location: "https://registry.npmjs.org/express/-/express-4.18.2.tgz",
    evidence: ["basic.spdx.json"],
  });
  expect(express.externalReferences).toEqual(
    expect.arrayContaining([
      {
        type: "sourceArtifact",
        locator: "https://github.com/expressjs/express/archive/refs/tags/4.18.2.tar.gz",
      },
      { type: "vcs", locator: "git+https://github.com/expressjs/express.git@4.18.2" },
    ]),
  );
  expect(express.externalReferences).toHaveLength(2);
});
