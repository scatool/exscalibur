import { join } from "node:path/posix";
import { extractSpdx } from "./index.ts";
import { createFileContentTests } from "@scatool/analyzer-test-utils";
import { describe, expect, test } from "vite-plus/test";

const fixturesDir = join(import.meta.dirname, "__fixtures__");

await createFileContentTests({
  extractFn: extractSpdx,
  fixturesDir,
  pattern: "*.spdx.{json,jsonld,yaml,yml}",
});

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
      const result = extractSpdx(createVersionTestDocument(specVersion), versionTestFile);

      expect(result.issues).toEqual([]);
      expect(result.packages).toEqual([
        {
          purl: "pkg:npm/example@1.0.0",
          evidence: [versionTestFile],
        },
      ]);
    },
  );

  test.each(["2.3.0", "4.0.0"])("rejects unsupported SPDX version %s", (specVersion) => {
    const result = extractSpdx(createVersionTestDocument(specVersion), versionTestFile);

    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "spdx.unsupported_version",
        message: `Unsupported SPDX version: ${specVersion} (expected 3.x)`,
        severity: "ERROR",
        file: versionTestFile,
      },
    ]);
  });

  test.each(["3.0", "3.00.1", "not-a-version", 3, null])(
    "rejects malformed SPDX version %s",
    (specVersion) => {
      const result = extractSpdx(createVersionTestDocument(specVersion), versionTestFile);

      expect(result.packages).toEqual([]);
      expect(result.issues).toEqual([
        {
          code: "spdx.invalid_version",
          message: `Invalid SPDX version: ${String(specVersion)} (expected a valid SemVer in the 3.x range)`,
          severity: "ERROR",
          file: versionTestFile,
        },
      ]);
    },
  );

  test("reports a missing specVersion", () => {
    const result = extractSpdx(createVersionTestDocument(), versionTestFile);

    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "spdx.not_spdx_document",
        message: "Not an SPDX 3.x document (could not determine specVersion)",
        severity: "WARNING",
        file: versionTestFile,
      },
    ]);
  });
});
