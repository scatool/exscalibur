// Regenerate only with an explicitly selected npm installation; no registry/network fallback.
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function capture(npmRoot, destination) {
  const require = createRequire(join(resolve(npmRoot), "package.json"));
  const Arborist = require("@npmcli/arborist");
  const npm = JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8"));
  const arborist = require("@npmcli/arborist/package.json");
  if (npm.version !== "11.9.0" || arborist.version !== "9.2.0")
    throw new Error("Oracle requires npm 11.9.0 / Arborist 9.2.0");
  const temporary = await mkdtemp(join(tmpdir(), "exscalibur-npm-optional-"));
  const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
  const options = {
    offline: true,
    ignoreScripts: true,
    audit: false,
    fund: false,
    progress: false,
    cache: join(temporary, "cache"),
    registry: "http://127.0.0.1:1",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
  };
  const packages = [
    { name: "leaf", version: "1.0.0" },
    { name: "leaf", version: "2.0.0" },
    { name: "parent", version: "1.0.0", dependencies: { leaf: "file:../packages/leaf-1.0.0.tgz" } },
    { name: "platform-ok", version: "1.0.0", os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
    { name: "platform-os", version: "1.0.0", os: ["!linux"] },
    { name: "platform-cpu", version: "1.0.0", cpu: ["!x64"] },
    { name: "platform-libc", version: "1.0.0", libc: ["!glibc"] },
  ];
  const serialize = (tree) => ({
    nodes: [...tree.inventory.values()]
      .filter((n) => !n.isRoot)
      .map((n) => ({
        location: n.location,
        name: n.name,
        version: n.version,
        optional: n.optional,
        os: n.package.os,
        cpu: n.package.cpu,
        libc: n.package.libc,
      }))
      .sort((a, b) => a.location.localeCompare(b.location)),
    edges: [...tree.inventory.values()]
      .flatMap((n) =>
        [...n.edgesOut.values()].map((e) => ({
          from: n.location,
          name: e.name,
          spec: e.spec,
          rawSpec: e.rawSpec,
          type: e.type,
          error: e.error ?? null,
          to: e.to?.location ?? null,
        })),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  const cases = [
    {
      id: "optional-overrides-required",
      manifest: {
        dependencies: { leaf: "file:../packages/leaf-1.0.0.tgz" },
        optionalDependencies: { leaf: "file:../packages/leaf-2.0.0.tgz" },
      },
    },
    {
      id: "optional-missing",
      manifest: { optionalDependencies: { missing: "file:../packages/missing-1.0.0.tgz" } },
    },
    {
      id: "optional-omitted",
      manifest: { optionalDependencies: { leaf: "file:../packages/leaf-1.0.0.tgz" } },
      omit: ["optional"],
    },
    ...["ok", "os", "cpu", "libc"].map((kind) => ({
      id: `optional-platform-${kind}`,
      manifest: {
        optionalDependencies: {
          [`platform-${kind}`]: `file:../packages/platform-${kind}-1.0.0.tgz`,
        },
      },
    })),
    {
      id: "required-platform-os",
      manifest: { dependencies: { "platform-os": "file:../packages/platform-os-1.0.0.tgz" } },
    },
    {
      id: "override-only-drift",
      manifest: {
        dependencies: { parent: "file:../packages/parent-1.0.0.tgz" },
        overrides: { leaf: "file:../packages/leaf-1.0.0.tgz" },
      },
      mutate: { overrides: { leaf: "file:../../../packages/leaf-2.0.0.tgz" } },
    },
  ];
  const report = {
    tools: { node: process.version, npm: npm.version, arborist: arborist.version },
    options: { ...options, cache: "<temporary>/cache" },
    sources: packages,
    cases: [],
  };
  try {
    await mkdir(join(temporary, "packages"));
    for (const pkg of packages) {
      const path = join(temporary, `${pkg.name}-${pkg.version}`);
      await mkdir(path);
      await json(join(path, "package.json"), pkg);
      execFileSync(
        process.execPath,
        [
          join(npmRoot, "bin/npm-cli.js"),
          "pack",
          path,
          "--offline",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          join(temporary, "packages"),
          "--cache",
          options.cache,
        ],
        { stdio: "pipe", env: { ...process.env, npm_config_registry: options.registry } },
      );
    }
    for (const item of cases) {
      const path = join(temporary, "project");
      await rm(path, { recursive: true, force: true });
      await mkdir(path);
      let manifest = { name: item.id, version: "1.0.0", ...item.manifest };
      await json(join(path, "package.json"), manifest);
      const outcome = { id: item.id, omit: item.omit ?? [] };
      try {
        await new Arborist({ ...options, path, packageLockOnly: true }).reify();
        outcome.lockGeneration = "success";
      } catch (error) {
        outcome.lockGeneration = {
          code: error.code,
          message: error.message.replaceAll(temporary, "<temporary>"),
        };
      }
      let lock;
      try {
        lock = JSON.parse(await readFile(join(path, "package-lock.json"), "utf8"));
      } catch {
        lock = null;
      }
      if (item.mutate) {
        manifest = { ...manifest, ...item.mutate };
        await json(join(path, "package.json"), manifest);
      }
      if (lock) {
        outcome.virtual = serialize(await new Arborist({ ...options, path }).loadVirtual());
        outcome.lockSha256 = createHash("sha256")
          .update(JSON.stringify(lock, null, 2) + "\n")
          .digest("hex");
      }
      try {
        await new Arborist({ ...options, path }).reify({ omit: item.omit ?? [] });
        outcome.install = "success";
      } catch (error) {
        outcome.install = {
          code: error.code,
          message: error.message.replaceAll(temporary, "<temporary>"),
        };
      }
      outcome.actual = serialize(await new Arborist({ ...options, path }).loadActual());
      outcome.installedManifests = [];
      for (const node of outcome.actual.nodes) {
        outcome.installedManifests.push({
          location: node.location,
          manifest: JSON.parse(await readFile(join(path, node.location, "package.json"), "utf8")),
        });
      }
      outcome.manifestSha256 = createHash("sha256")
        .update(JSON.stringify(manifest, null, 2) + "\n")
        .digest("hex");
      const dir = join(destination, item.id);
      await mkdir(dir, { recursive: true });
      await json(join(dir, "package.json"), manifest);
      if (lock) await json(join(dir, "package-lock.json"), lock);
      report.cases.push(outcome);
    }
    await mkdir(destination, { recursive: true });
    await json(join(destination, "native-observations.json"), report);
    return report;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error("Usage: node npm-optional-oracle.mjs <npm-root> <output-directory>");
  await capture(resolve(process.argv[2]), resolve(process.argv[3]));
}
