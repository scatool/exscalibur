#!/usr/bin/env bun

import { file, spawn } from 'bun';
import { join } from 'node:path/posix';

const REPOSITORIES_FILE = join(import.meta.dir, '..', 'repositories.json');
const OUTPUT_DIR = join(import.meta.dir, '..', 'repositories');

interface RepositoryConfig {
  owner: string;
  repository: string;
  commit: string;
  javaVersion?: number;
}

async function downloadAndExtract(owner: string, repo: string, commit: string, outputPath: string): Promise<void> {
  // Download archive from GitHub
  const url = `https://github.com/${owner}/${repo}/archive/${commit}.tar.gz`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  // Create a temporary file for the tarball
  const tempTarball = join(outputPath, '..', `${owner}+${repo}.tar.gz`);
  await Bun.write(tempTarball, response);

  // Extract using tar - extract to outputPath with strip-components
  const proc = spawn({
    cmd: ['tar', '-xzf', tempTarball, '-C', outputPath, '--strip-components=1'],
    stdout: 'ignore',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Extraction failed: ${stderr}`);
  }

  // Clean up tarball
  await Bun.write(tempTarball, '');
  const tempFile = file(tempTarball);
  if (await tempFile.exists()) {
    await Bun.file(tempTarball).delete();
  }
}

async function main() {
  console.log('Reading repositories list...');
  const repositoriesFile = file(REPOSITORIES_FILE);
  const repositories: RepositoryConfig[] = await repositoriesFile.json();

  console.log(`Found ${repositories.length} repositories to download\n`);

  // Create output directory
  await Bun.write(join(OUTPUT_DIR, '.gitkeep'), '');

  let successful = 0;
  let failed = 0;

  for (let i = 0; i < repositories.length; i++) {
    const config = repositories[i];
    const { owner, repository: repo, commit } = config;
    const repoName = `${owner}+${repo}`;
    const repoPath = join(OUTPUT_DIR, repoName);

    console.log(`[${i + 1}/${repositories.length}] ${repoName}`);

    // Skip if already exists (check for common manifest files)
    const manifestFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];
    let alreadyExists = false;
    for (const manifest of manifestFiles) {
      if (await file(join(repoPath, manifest)).exists()) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) {
      console.log(`  ⏭️  Already exists, skipping`);
      successful++;
      continue;
    }

    try {
      // Create directory for this repo
      await Bun.write(join(repoPath, '.gitkeep'), '');

      // Download and extract
      await downloadAndExtract(owner, repo, commit, repoPath);

      console.log(`  ✅ Downloaded`);
      successful++;
    } catch (error) {
      console.error(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📁 Output: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
