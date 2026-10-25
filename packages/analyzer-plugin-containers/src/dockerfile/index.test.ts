import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { normalizeResult, validateResult } from "@scatool/analyzer-core";
import { extractDockerfile } from "./index.ts";

const expected: Record<string, string[]> = {
  "arg-before-from": ["${BASE_IMAGE}"],
  basic: ["alpine:3.18"],
  "digest-only": ["node@sha256:cd39fdfb3bb0a8da539fe0b7bc13cb12b49c05d169895cbf5351c340dfe42357"],
  ghcr: ["ghcr.io/actions/runner:2.319.1"],
  "mcr-deep-path": ["mcr.microsoft.com/dotnet/sdk:8.0"],
  "multi-arg-registry-namespace": [
    "${REGISTRY}/${NAMESPACE}/${IMAGE}:${TAG}",
    "${REGISTRY}/${NAMESPACE}/busybox:1.36",
  ],
  "multistage-internal-base": ["alpine"],
  "platform-variant": ["alpine:3.18"],
  "private-registry-port": ["registry.example.com:5000/private/app-base:1.2.3"],
  scratch: [],
  "tag-and-digest": [
    "ubuntu:22.04@sha256:3c282906f58630659f57e5fcae551eeeee54fa8ac4bfa2dc4c4f7deb6bf7e08c",
  ],
  "whitespace-and-comments": ["alpine:3.18"],
};
const fixtures = join(import.meta.dirname, "__fixtures__");
for (const file of await readdir(fixtures)) {
  test(`native Dockerfile fixture: ${file}`, async () => {
    const result = extractDockerfile(await readFile(join(fixtures, file), "utf8"), file, "fixture");
    validateResult(result);
    expect(
      result.graphs[0]!.edges.map((edge) => edge.requested?.specifier).sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    ).toEqual(expected[file.slice("Dockerfile.".length)]!.toSorted((a, b) => a.localeCompare(b)));
    expect(result.graphs[0]!.edges.every((edge) => edge.status === "declared")).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.graphs[0]!.roots[0]!.project.definitionFile).toBe(file);

    expect(normalizeResult(result)).toMatchSnapshot();
  });
}
