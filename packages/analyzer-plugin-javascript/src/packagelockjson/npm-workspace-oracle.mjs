// Native test oracle only. No runtime extractor dependency or network fallback.
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function capture(npmRoot, destination) {
  const require = createRequire(join(npmRoot, "package.json"));
  const Arborist = require("@npmcli/arborist"),
    cacache = require("cacache");
  const npm = require("./package.json"),
    arborist = require("@npmcli/arborist/package.json");
  if (npm.version !== "11.9.0" || arborist.version !== "9.2.0")
    throw new Error("Requires npm11.9.0/Arborist9.2.0");
  const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const formatterVersion = execFileSync("vp", ["fmt", "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  if (formatterVersion !== "Version: 0.73.0")
    throw new Error("Requires Oxfmt 0.73.0 through pinned Vite+");
  const formatJson = (path, text) =>
    execFileSync("vp", ["fmt", `--stdin-filepath=${basename(path)}`], {
      cwd: repositoryRoot,
      input: text,
      encoding: "utf8",
    });
  const temporary = await mkdtemp(join(tmpdir(), "exscalibur-workspace-oracle-"));
  const write = async (path, value) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, formatJson(path, JSON.stringify(value, null, 2) + "\n"));
  };
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const registry = "http://127.0.0.1:1/";
  const cache = join(temporary, "cache");
  const leaf = { name: "real-leaf", version: "1.0.0" };
  const sources = {
    "package.json": {
      name: "workspace-oracle",
      version: "1.0.0",
      private: true,
      workspaces: ["apps/*", "packages/*"],
      dependencies: { renamed: "npm:real-leaf@1.0.0", "local-link": "file:local" },
    },
    "apps/app/package.json": {
      name: "workspace-app",
      version: "1.0.0",
      dependencies: { "workspace-lib": "*", renamed: "npm:real-leaf@1.0.0" },
    },
    "packages/lib/package.json": { name: "workspace-lib", version: "1.0.0" },
    "local/package.json": {
      name: "local-link",
      version: "1.0.0",
      dependencies: { renamed: "npm:real-leaf@1.0.0" },
    },
  };
  const serialize = (tree) => ({
    nodes: [...tree.inventory.values()]
      .map((n) => ({
        location: n.location,
        name: n.name,
        packageName: n.package.name,
        version: n.version,
        link: n.isLink,
        target: n.isLink ? n.target.location : null,
      }))
      .sort((a, b) => a.location.localeCompare(b.location)),
    edges: [...tree.inventory.values()]
      .flatMap((n) =>
        [...n.edgesOut.values()].map((e) => ({
          from: n.location,
          name: e.name,
          spec: e.spec.replaceAll(join(temporary, "project"), "<project>"),
          type: e.type,
          error: e.error ?? null,
          to: e.to?.location ?? null,
          target: e.to?.isLink ? e.to.target.location : null,
        })),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  const report = {
    tools: { node: process.version, npm: npm.version, arborist: arborist.version, oxfmt: "0.73.0" },
    offline: true,
    ignoreScripts: true,
    registry,
    aliasSource: leaf,
    sourceManifests: sources,
    cases: [],
  };
  try {
    await write(join(temporary, "leaf/package.json"), leaf);
    execFileSync(
      process.execPath,
      [
        join(npmRoot, "bin/npm-cli.js"),
        "pack",
        join(temporary, "leaf"),
        "--offline",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporary,
        "--cache",
        cache,
      ],
      { stdio: "pipe", env: { ...process.env, npm_config_registry: registry } },
    );
    const bytes = await readFile(join(temporary, "real-leaf-1.0.0.tgz"));
    const integrity = String(await cacache.put(cache, "authored-real-leaf-tarball", bytes));
    const packument = {
      name: leaf.name,
      "dist-tags": { latest: leaf.version },
      versions: {
        [leaf.version]: {
          ...leaf,
          dist: { tarball: `${registry}real-leaf/-/real-leaf-1.0.0.tgz`, integrity },
        },
      },
    };
    report.seededPackument = packument;
    const options = {
      offline: true,
      ignoreScripts: true,
      audit: false,
      fund: false,
      cache,
      registry,
      packumentCache: new Map([
        [`full:${registry}real-leaf`, packument],
        [`corgi:${registry}real-leaf`, packument],
      ]),
    };
    for (const version of [1, 2, 3]) {
      const path = join(temporary, "project");
      await rm(path, { recursive: true, force: true });
      for (const [file, manifest] of Object.entries(sources))
        await write(join(path, file), manifest);
      await new Arborist({ ...options, path, lockfileVersion: version }).reify();
      const installed = serialize(await new Arborist({ ...options, path }).loadActual());
      const lockText = await readFile(join(path, "package-lock.json"), "utf8");
      for (const mode of ["current", "missing", "stale"]) {
        await rm(path, { recursive: true, force: true });
        const inputs = structuredClone(sources);
        if (mode === "missing") delete inputs["apps/app/package.json"];
        if (mode === "stale")
          inputs["apps/app/package.json"] = {
            ...inputs["apps/app/package.json"],
            dependencies: { "workspace-lib": "*" },
          };
        for (const [file, manifest] of Object.entries(inputs))
          await write(join(path, file), manifest);
        await writeFile(join(path, "package-lock.json"), lockText);
        const result = {
          id: `v${version}-${mode}`,
          lockfileVersion: version,
          mode,
          inputSha256: Object.fromEntries(
            await Promise.all(
              [...Object.keys(inputs), "package-lock.json"].map(async (file) => [
                file,
                hash(await readFile(join(path, file))),
              ]),
            ),
          ),
          installedBeforeMutation: installed,
        };
        try {
          result.virtual = serialize(await new Arborist({ ...options, path }).loadVirtual());
        } catch (error) {
          result.virtualError = {
            code: error.code,
            message: error.message.replaceAll(temporary, "<temporary>"),
          };
        }
        const dir = join(destination, result.id);
        await mkdir(dir, { recursive: true });
        for (const [file, manifest] of Object.entries(inputs))
          await write(join(dir, file), manifest);
        await writeFile(join(dir, "package-lock.json"), lockText);
        report.cases.push(result);
      }
    }
    await write(join(destination, "native-observations.json"), report);
    return report;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error("Usage: node npm-workspace-oracle.mjs <npm-root> <output-directory>");
  await capture(resolve(process.argv[2]), resolve(process.argv[3]));
}
