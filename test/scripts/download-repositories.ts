#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORIES_FILE = join(import.meta.dirname, "..", "repositories.json");
const OUTPUT_DIR = join(import.meta.dirname, "..", "repositories");
export type Transport = "archive" | "git";
export type RepositoryConfig = { owner: string; repository: string; commit: string };
type Receipt = RepositoryConfig & {
  tree: string | null;
  transport: Transport;
  archiveSha256: string;
};

/** Transport choice is explicit; a failed/denied endpoint never triggers another transport. */
export function parseArguments(args: string[]): { transport: Transport; cases: string[] } {
  let transport: Transport = "archive";
  const cases: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transport") {
      const value = args[++i];
      if (value !== "archive" && value !== "git")
        throw new Error("--transport requires archive or git");
      transport = value;
    } else if (args[i] === "--case") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--case requires owner+repository");
      cases.push(value);
    } else
      throw new Error(
        `Unknown argument: ${args[i]}. Use --transport archive|git and optional --case owner+repository.`,
      );
  }
  return { transport, cases };
}

export function selectRepositories(
  repositories: RepositoryConfig[],
  cases: string[],
): RepositoryConfig[] {
  for (const repo of repositories) {
    if (
      !/^[A-Za-z0-9_.-]+$/.test(repo.owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repo.repository) ||
      [repo.owner, repo.repository].some((value) => value === "." || value === "..") ||
      !/^[0-9a-f]{40}$/.test(repo.commit)
    )
      throw new Error(
        "Repository configuration must contain safe names and exact 40-character commit IDs",
      );
  }
  for (const name of cases)
    if (!repositories.some((repo) => `${repo.owner}+${repo.repository}` === name))
      throw new Error(`Unknown repository case: ${name}`);
  return repositories.filter(
    (repo) => cases.length === 0 || cases.includes(`${repo.owner}+${repo.repository}`),
  );
}

export function matchingReceipt(value: unknown, config: RepositoryConfig): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<Receipt>;
  return (
    receipt.owner === config.owner &&
    receipt.repository === config.repository &&
    receipt.commit === config.commit &&
    typeof receipt.archiveSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(receipt.archiveSha256) &&
    ((receipt.transport === "git" &&
      typeof receipt.tree === "string" &&
      /^[0-9a-f]{40}$/.test(receipt.tree)) ||
      (receipt.transport === "archive" && receipt.tree === null))
  );
}

/** Only absent directories and empty/.gitkeep-only placeholders may be replaced. */
export async function directoryState(
  path: string,
): Promise<"absent" | "placeholder" | "populated"> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return "absent";
  if (!entry.isDirectory()) throw new Error(`Refusing non-directory or symlink target: ${path}`);
  const entries = await readdir(path);
  if (entries.length === 0) return "placeholder";
  if (entries.length === 1 && entries[0] === ".gitkeep") {
    const keep = await lstat(join(path, ".gitkeep"));
    if (keep.isFile() && keep.size === 0) return "placeholder";
  }
  return "populated";
}

async function command(program: string, args: string[]): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolveCommand(stdout.trim())
        : reject(new Error(`${program} failed (${code}): ${stderr}`)),
    );
  });
}

async function clearLegacyMarker(path: string): Promise<void> {
  const marker = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!marker) return;
  if (!marker.isFile() || marker.size !== 0) {
    throw new Error(
      `Preserving nonempty or nonregular legacy archive marker ${path}; move it aside explicitly`,
    );
  }
  await unlink(path);
}

export async function acquireRepository(
  config: RepositoryConfig,
  transport: Transport,
  outputDir = OUTPUT_DIR,
): Promise<"cached" | "downloaded"> {
  selectRepositories([config], []);
  const name = `${config.owner}+${config.repository}`;
  const destination = join(outputDir, name);
  const receiptsDir = join(outputDir, ".sources");
  const receiptPath = join(receiptsDir, `${name}.json`);
  const legacyMarker = join(outputDir, `${name}.tar.gz`);
  const state = await directoryState(destination);
  if (state === "populated") {
    let receipt: unknown;
    try {
      receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch {
      /* Unverified cache must never be overwritten. */
    }
    if (matchingReceipt(receipt, config)) {
      await clearLegacyMarker(legacyMarker);
      return "cached";
    }
    throw new Error(
      `Preserving existing unverified directory ${destination}; move it aside explicitly before downloading`,
    );
  }
  await mkdir(outputDir, { recursive: true });
  const staging = await mkdtemp(join(outputDir, ".download-"));
  try {
    const extracted = join(staging, "source");
    const archive = join(staging, transport === "git" ? "source.tar" : "source.tar.gz");
    await mkdir(extracted);
    let tree: string | null = null;
    if (transport === "git") {
      const repository = join(staging, "repository.git");
      await command("git", ["init", "--bare", repository]);
      await command("git", [
        "--git-dir",
        repository,
        "fetch",
        "--no-tags",
        "--depth=1",
        `https://github.com/${config.owner}/${config.repository}.git`,
        config.commit,
      ]);
      const commit = await command("git", [
        "--git-dir",
        repository,
        "rev-parse",
        "FETCH_HEAD^{commit}",
      ]);
      if (commit !== config.commit)
        throw new Error(`Fetched commit ${commit} does not match configured ${config.commit}`);
      tree = await command("git", ["--git-dir", repository, "rev-parse", `${commit}^{tree}`]);
      if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error("Invalid fetched Git tree ID");
      await command("git", [
        "--git-dir",
        repository,
        "archive",
        "--format=tar",
        `--output=${archive}`,
        commit,
      ]);
      await command("tar", ["-xf", archive, "-C", extracted]);
    } else {
      const response = await fetch(
        `https://github.com/${config.owner}/${config.repository}/archive/${config.commit}.tar.gz`,
      );
      if (!response.ok)
        throw new Error(`Archive download failed: ${response.status} ${response.statusText}`);
      await writeFile(archive, Buffer.from(await response.arrayBuffer()));
      await command("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1"]);
    }
    if ((await directoryState(extracted)) !== "populated")
      throw new Error("Downloaded archive contains no source files");
    const receipt: Receipt = {
      owner: config.owner,
      repository: config.repository,
      commit: config.commit,
      tree,
      transport,
      archiveSha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    };
    await writeFile(join(staging, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    // Recheck after download: never replace a directory populated by another process/user.
    const current = await directoryState(destination);
    if (current === "populated")
      throw new Error(`Target changed during download; preserving ${destination}`);
    if (current === "placeholder") {
      const keep = join(destination, ".gitkeep");
      const entries = await readdir(destination);
      if (entries.length === 1 && entries[0] === ".gitkeep") await unlink(keep);
      await rmdir(destination);
    }
    await rename(extracted, destination);
    await mkdir(receiptsDir, { recursive: true });
    await rename(join(staging, "receipt.json"), receiptPath);
    await clearLegacyMarker(legacyMarker);
    return "downloaded";
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(args);
  const repositories = selectRepositories(
    JSON.parse(await readFile(REPOSITORIES_FILE, "utf8")),
    options.cases,
  );
  let failed = 0;
  for (const config of repositories) {
    const name = `${config.owner}+${config.repository}`;
    try {
      console.log(`${name}: ${await acquireRepository(config, options.transport)}`);
    } catch (error) {
      failed++;
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(
    `Successful: ${repositories.length - failed}; failed: ${failed}; transport: ${options.transport}`,
  );
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
