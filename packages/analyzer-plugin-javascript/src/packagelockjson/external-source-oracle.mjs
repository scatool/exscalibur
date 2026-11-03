// Native, offline review oracle only; not imported by extraction or normal tests.
// Usage: node external-source-oracle.mjs /path/to/npm
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const npmRoot = process.argv[2];
if (!npmRoot) throw new Error("Pass the directory containing npm's package.json");
const require = createRequire(join(resolve(npmRoot), "package.json"));
const npmVersion = require("./package.json").version;
const arboristVersion = require("@npmcli/arborist/package.json").version;
if (process.version !== "v22.23.4" || npmVersion !== "11.9.0" || arboristVersion !== "9.2.0")
  throw new Error("Requires Node 22.23.4, npm 11.9.0 and Arborist 9.2.0");
const Arborist = require("@npmcli/arborist");
const directory = await mkdtemp(join(tmpdir(), "npm-external-source-oracle-"));
try {
  const results = [];
  for (const ancestorRecorded of [false, true]) {
    const parent = join(directory, ancestorRecorded ? "recorded-ancestor" : "sibling-only");
    const path = join(parent, "project");
    await mkdir(path, { recursive: true });
    await mkdir(join(parent, "external"));
    const manifest = {
      name: "root",
      version: "1.0.0",
      dependencies: { local: "file:../external" },
    };
    const external = { name: "local", version: "1.0.0", dependencies: { leaf: "*" } };
    await writeFile(join(path, "package.json"), JSON.stringify(manifest));
    await writeFile(join(parent, "external/package.json"), JSON.stringify(external));
    await writeFile(
      join(path, "package-lock.json"),
      JSON.stringify({
        name: "root",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {
          "": manifest,
          "../external": external,
          "node_modules/local": { link: true, resolved: "../external" },
          "node_modules/leaf": { version: "1.0.0" },
          ...(ancestorRecorded && { "../node_modules/leaf": { version: "2.0.0" } }),
        },
      }),
    );
    const tree = await new Arborist({
      path,
      offline: true,
      ignoreScripts: true,
      audit: false,
      fund: false,
    }).loadVirtual();
    const node = [...tree.inventory.values()].find(
      (candidate) => candidate.location === "../external" && !candidate.isLink,
    );
    assert.ok(node);
    const edge = node.edgesOut.get("leaf");
    assert.ok(edge);
    const observation = {
      ancestorRecorded,
      owner: node.location,
      name: edge.name,
      error: edge.error ?? null,
      target: edge.to?.location ?? null,
      version: edge.to?.version ?? null,
    };
    assert.deepEqual(observation, {
      ancestorRecorded,
      owner: "../external",
      name: "leaf",
      // loadVirtual does not attach this hand-authored external ancestor record.
      // The record is not evidence of native installation or virtual-tree selection.
      error: "MISSING",
      target: null,
      version: null,
    });
    results.push(observation);
  }
  console.log(
    JSON.stringify(
      { tools: { node: process.version, npm: npmVersion, arborist: arboristVersion }, results },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
