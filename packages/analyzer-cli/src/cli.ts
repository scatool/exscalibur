#!/usr/bin/env bun

import {
  bunlockExtractor,
  denoLockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
} from '@scatool/analyzer-plugin-javascript/src/index.ts';
import { dockerfileExtractor } from '@scatool/analyzer-plugin-containers/src/index.ts';
import { gradleExtractor } from '@scatool/analyzer-plugin-gradle/src/index.ts';
import { gomodExtractor } from '@scatool/analyzer-plugin-go/src/index.ts';
import { extractor as uvExtractor } from '@scatool/analyzer-plugin-uv/src/index.ts';
import { mergeResults } from '@scatool/analyzer-core/src/index.ts';
import { extractor as githubActionsExtractor } from '@scatool/analyzer-plugin-github-actions/src/index.ts';
import {
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
  requirementsTxtExtractor,
} from '@scatool/analyzer-plugin-python/src/index.ts';
import { cargoLockExtractor } from '@scatool/analyzer-plugin-rust/src/index.ts';
import { mavenExtractor } from '@scatool/analyzer-plugin-maven/src/index.ts';
import { extractor as cyclonedxExtractor } from '@scatool/analyzer-plugin-cdx/src/index.ts';
import { ortExtractor } from '@scatool/analyzer-plugin-ort/src/index.ts';
import type { AnalyzerResult, Extractor } from '@scatool/analyzer-core/src/index.ts';
import { resolve } from 'path';

const args = process.argv.slice(2);

const enabledExtractors = new Set<string>();
const disabledExtractors = new Set<string>();
const positionalArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--enable' || arg === '-e') {
    i++;
    if (i < args.length) {
      const names = args[i]
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      for (const name of names) {
        enabledExtractors.add(name);
      }
    }
  } else if (arg === '--disable' || arg === '-d') {
    i++;
    if (i < args.length) {
      const names = args[i]
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      for (const name of names) {
        disabledExtractors.add(name);
      }
    }
  } else if (!arg.startsWith('-')) {
    positionalArgs.push(arg);
  }
}

if (positionalArgs.length < 2) {
  console.error('Usage: analyzer [options] <codebase-path> <output-path>');
  console.error('');
  console.error('Arguments:');
  console.error('  codebase-path  Path to the codebase to analyze');
  console.error('  output-path    Path to write the JSON output file');
  console.error('');
  console.error('Options:');
  console.error('  --enable, -e <name>   Enable specific extractor(s) (comma-separated or multiple flags)');
  console.error('  --disable, -d <name>  Disable specific extractor(s) (comma-separated or multiple flags)');
  console.error('');
  console.error('Available extractors:');
  console.error('  bunlock           Extract from bun.lock files');
  console.error('  packagejson       Extract from package.json files');
  console.error('  packagelockjson   Extract from package-lock.json files');
  console.error('  pnpmlock          Extract from pnpm-lock.yaml files');
  console.error('  yarnberry         Extract from yarn.lock files (Yarn Berry/Modern)');
  console.error('  yarnlock          Extract from yarn.lock files (Yarn v1/Classic)');
  console.error('  dockerfile        Extract from Dockerfile files');
  console.error('  github-actions    Extract from GitHub Actions workflow files');
  console.error('  gradle            Extract from Gradle projects (build.gradle)');
  console.error('  gomod             Extract from Go modules (go.mod)');
  console.error('  uv                Extract from uv projects (uv.lock)');
  console.error('  denolock          Extract from deno.lock files');
  console.error('  pipfilelock       Extract from Pipfile.lock files');
  console.error('  poetrylock        Extract from poetry.lock files');
  console.error('  pdmlock           Extract from pdm.lock files');
  console.error('  requirementstxt   Extract from requirements.txt files');
  console.error('  cargolock         Extract from Cargo.lock files');
  console.error('  maven             Extract from Maven pom.xml files');
  console.error('  cyclonedx         Extract from CycloneDX BOM files');
  console.error('  ort               Extract from ORT result files');
  process.exit(1);
}

const codebasePath = resolve(positionalArgs[0]);
const outputPath = resolve(positionalArgs[1]);

const allExtractors: Extractor[] = [
  bunlockExtractor,
  denoLockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnBerryExtractor,
  yarnLockExtractor,
  dockerfileExtractor,
  githubActionsExtractor,
  gradleExtractor,
  gomodExtractor,
  uvExtractor,
  pipfileLockExtractor,
  poetryLockExtractor,
  pdmLockExtractor,
  requirementsTxtExtractor,
  cargoLockExtractor,
  mavenExtractor,
  cyclonedxExtractor,
  ortExtractor,
];

function filterExtractors(extractors: Extractor[]): Extractor[] {
  if (enabledExtractors.size > 0) {
    return extractors.filter((e) => enabledExtractors.has(e.name));
  }

  if (disabledExtractors.size > 0) {
    return extractors.filter((e) => !disabledExtractors.has(e.name));
  }

  return extractors;
}

const extractors = filterExtractors(allExtractors);

async function runAnalysis(): Promise<void> {
  console.error('Running analysis...');
  console.error(`Codebase: ${codebasePath}`);
  console.error(`Output: ${outputPath}`);
  console.error(`Active extractors: ${extractors.map((e) => e.name).join(', ')}`);
  console.error('');

  const results: AnalyzerResult[] = [];

  for (const extractor of extractors) {
    try {
      console.error(`Running ${extractor.name} extractor (version ${extractor.version})...`);
      const result = await extractor.extract(codebasePath);
      results.push(result);
      console.error(`  Found ${result.packages.length} packages`);
      console.error(`  Found ${result.subprojects.length} subprojects`);
      console.error(`  Found ${result.relationships.length} relationships`);
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.error('');
  console.error('Merging results...');

  const mergedResult = mergeResults(results);

  console.error(`Total packages: ${mergedResult.packages.length}`);
  console.error(`Total subprojects: ${mergedResult.subprojects.length}`);
  console.error(`Total relationships: ${mergedResult.relationships.length}`);

  console.error('');
  console.error(`Writing output to ${outputPath}...`);
  await Bun.write(outputPath, JSON.stringify(mergedResult, null, 2));
  console.error('Done!');
}

try {
  await runAnalysis();
} catch (error) {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
