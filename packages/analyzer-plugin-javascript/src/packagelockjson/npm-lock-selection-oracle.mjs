import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const npmRoot = process.argv[2];
if (!npmRoot)
  throw new Error("Usage: node npm-lock-selection-oracle.mjs <npm-package-directory> [--write]");
const requireNpm = createRequire(join(npmRoot, "package.json"));
const Arborist = requireNpm("@npmcli/arborist");
const versions = {
  node: process.versions.node,
  npm: JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8")).version,
  arborist: requireNpm("@npmcli/arborist/package.json").version,
};
if (versions.node !== "22.23.4" || versions.npm !== "11.9.0" || versions.arborist !== "9.2.0") {
  throw new Error(`Unexpected native versions: ${JSON.stringify(versions)}`);
}
const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "npm-lock-selection-oracle",
);
const inputBytes = await readFile(join(fixtures, "inputs.json"));
const observations = [];
for (const fixture of JSON.parse(inputBytes.toString("utf8"))) {
  const temporary = await mkdtemp(join(tmpdir(), "npm-lock-selection-"));
  // Arborist derives missing root names from the directory basename. Make that visible and stable.
  const directory = join(temporary, "project");
  try {
    await mkdir(directory);
    for (const [file, value] of Object.entries(fixture.files)) {
      await writeFile(
        join(directory, file),
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    let observation;
    try {
      const tree = await new Arborist({
        path: directory,
        offline: true,
        audit: false,
      }).loadVirtual();
      observation = {
        selectedLock: basename(tree.meta.filename),
        root: { name: tree.package.name ?? null, version: tree.package.version ?? null },
        edges: [...tree.edgesOut.values()].map((edge) => ({
          name: edge.name,
          spec: edge.spec,
          to: edge.to?.location ?? null,
          version: edge.to?.version ?? null,
          error: edge.error ?? null,
        })),
      };
    } catch (error) {
      if (error.code !== "ENOLOCK") throw error;
      observation = { error: error.code };
    }
    observations.push({ id: fixture.id, ...observation });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
const result = {
  versions,
  inputSha256: createHash("sha256").update(inputBytes).digest("hex"),
  observations,
};
const outputFile = join(fixtures, "native-output.json");
if (process.argv.includes("--write"))
  await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`);
else if (
  JSON.stringify(result) !== JSON.stringify(JSON.parse(await readFile(outputFile, "utf8")))
) {
  throw new Error("Native lock selection changed");
}
console.log(`Verified ${observations.length} native lock-selection cases`);
