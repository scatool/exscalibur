#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";

const REPOSITORIES_FILE = join(import.meta.dirname, "..", "repositories.json");
const OUTPUT_DIR = join(import.meta.dirname, "..", "repositories");

interface RepositoryConfig {
  owner: string;
  repository: string;
  commit: string;
  javaVersion?: number;
}

async function downloadAndExtract(
  owner: string,
  repo: string,
  commit: string,
  outputPath: string,
  downloadPath: string,
): Promise<void> {
  // Download archive from GitHub
  const url = `https://github.com/${owner}/${repo}/archive/${commit}.tar.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  // Create a temporary file for the tarball
  await writeFile(downloadPath, Buffer.from(await response.arrayBuffer()));

  // Extract using tar - extract to outputPath with strip-components
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", ["-xzf", downloadPath, "-C", outputPath, "--strip-components=1"], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.on("error", reject);
    proc.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Extraction failed: ${stderr}`));
      }
    });
  });

  // Clean up tarball
  if (existsSync(downloadPath)) {
    await rm(downloadPath);
  }
}

async function main() {
  console.log("Reading repositories list...");
  const repositories: RepositoryConfig[] = JSON.parse(await readFile(REPOSITORIES_FILE, "utf8"));

  console.log(`Found ${repositories.length} repositories to download\n`);

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, ".gitkeep"), "");

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < repositories.length; i++) {
    const config = repositories[i];
    const { owner, repository: repo, commit } = config;
    const repoName = `${owner}+${repo}`;
    const repoPath = join(OUTPUT_DIR, repoName);
    const tarballPath = join(OUTPUT_DIR, `${owner}+${repo}.tar.gz`);

    console.log(`[${i + 1}/${repositories.length}] ${repoName}`);

    // If the directory does already exist, but so does the tarball file
    // we know, we need to redownload, as apparently the previous download was not successful
    const repoPathStat = await stat(repoPath).catch(() => null);
    const alreadyExists =
      repoPathStat !== null && repoPathStat.isDirectory() && !existsSync(tarballPath);
    if (alreadyExists) {
      console.log(`  Already exists, skipping`);
      successful++;
      continue;
    }

    try {
      // Signal to start with the download
      await writeFile(tarballPath, "");

      // Create directory for this repo
      await mkdir(repoPath, { recursive: true });
      await writeFile(join(repoPath, ".gitkeep"), "");

      // Download and extract
      await downloadAndExtract(owner, repo, commit, repoPath, tarballPath);

      console.log(`  Downloaded`);
      successful++;
    } catch (error) {
      console.error(`  Failed: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Output: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
