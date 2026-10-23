import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Explicitly use npm's bundled Arborist, never a downloaded or independently resolved copy.
const npmRoot = process.argv[2];
if (!npmRoot) throw new Error("Usage: node npm-peer-oracle.mjs <npm-package-directory> [--write]");
const requireNpm = createRequire(join(npmRoot, "package.json"));
const Arborist = requireNpm("@npmcli/arborist");
const versions = {
  node: process.versions.node,
  npm: JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8")).version,
  arborist: requireNpm("@npmcli/arborist/package.json").version,
};
if (versions.node !== "22.23.4" || versions.npm !== "11.9.0" || versions.arborist !== "9.2.0") {
  throw new Error(`Unexpected oracle versions: ${JSON.stringify(versions)}`);
}
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "npm-peer-oracle");
const inputBytes = await readFile(join(fixtures, "inputs.json"));
const inputs = JSON.parse(inputBytes.toString("utf8"));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const results = [];
for (const fixture of inputs) {
  const directory = await mkdtemp(join(tmpdir(), "npm-peer-oracle-"));
  try {
    const lock = { ...fixture.packages[""], lockfileVersion: 3, packages: fixture.packages };
    await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
    // These are controlled installed manifests, not the result of an npm installation.
    for (const [location, manifest] of Object.entries(fixture.packages)) {
      await mkdir(join(directory, location), { recursive: true });
      await writeFile(join(directory, location, "package.json"), JSON.stringify(manifest));
    }
    const observations = {};
    for (const method of ["loadVirtual", "loadActual"]) {
      // Both methods only read local trees; never invoke buildIdealTree/reify/install.
      const tree = await new Arborist({ path: directory, offline: true, audit: false })[method]();
      observations[method] = [...tree.inventory.values()]
        .flatMap((node) => [...node.edgesOut.values()])
        .map((edge) => ({
          from: edge.from.location,
          name: edge.name,
          rawSpec: edge.rawSpec,
          spec: edge.spec,
          type: edge.type,
          peer: edge.peer,
          optional: edge.optional,
          to: edge.to?.location ?? null,
          valid: edge.valid,
          error: edge.error ?? null,
        }))
        .sort((a, b) =>
          compare(JSON.stringify([a.from, a.name]), JSON.stringify([b.from, b.name])),
        );
    }
    results.push({ id: fixture.id, ...observations });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const output = {
  versions,
  inputSha256: createHash("sha256").update(inputBytes).digest("hex"),
  observations: results,
};
const outputFile = join(fixtures, "native-output.json");
if (process.argv.includes("--write")) {
  await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`);
} else {
  const recorded = JSON.parse(await readFile(outputFile, "utf8"));
  if (JSON.stringify(output) !== JSON.stringify(recorded)) throw new Error("Native oracle changed");
}
console.log(
  `Verified ${results.length} cases against both native tree readers (${versions.npm}/${versions.arborist})`,
);
