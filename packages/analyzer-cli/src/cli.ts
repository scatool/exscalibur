#!/usr/bin/env bun

import { Command } from 'commander';
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

const program = new Command();

program
  .name('analyzer')
  .description('Extract dependency graphs from software projects')
  .argument('<codebase-path>', 'Path to the codebase to analyze')
  .argument('<output-path>', 'Path to write the JSON output file')
  .option(
    '-e, --enable <names>',
    'Enable specific extractor(s) (comma-separated or multiple flags)',
    (value: string, previous: string[] | undefined) => {
      const names = value
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      return previous ? [...previous, ...names] : names;
    },
    [] as string[],
  )
  .option(
    '-d, --disable <names>',
    'Disable specific extractor(s) (comma-separated or multiple flags)',
    (value: string, previous: string[] | undefined) => {
      const names = value
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      return previous ? [...previous, ...names] : names;
    },
    [] as string[],
  )
  .addHelpText(
    'after',
    `
Available extractors:
  bunlock           Extract from bun.lock files
  packagejson       Extract from package.json files
  packagelockjson   Extract from package-lock.json files
  pnpmlock          Extract from pnpm-lock.yaml files
  yarnberry         Extract from yarn.lock files (Yarn Berry/Modern)
  yarnlock          Extract from yarn.lock files (Yarn v1/Classic)
  dockerfile        Extract from Dockerfile files
  github-actions    Extract from GitHub Actions workflow files
  gradle            Extract from Gradle projects (build.gradle)
  gomod             Extract from Go modules (go.mod)
  uv                Extract from uv projects (uv.lock)
  denolock          Extract from deno.lock files
  pipfilelock       Extract from Pipfile.lock files
  poetrylock        Extract from poetry.lock files
  pdmlock           Extract from pdm.lock files
  requirementstxt   Extract from requirements.txt files
  cargolock         Extract from Cargo.lock files
  maven             Extract from Maven pom.xml files
  cyclonedx         Extract from CycloneDX BOM files
  ort               Extract from ORT result files
`,
  )
  .action(async (codebasePath, outputPath, options) => {
    try {
      const enabledExtractors: Set<string> = new Set(options.enable);
      const disabledExtractors: Set<string> = new Set(options.disable);

      const codebasePathResolved = resolve(codebasePath);
      const outputPathResolved = resolve(outputPath);

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

      const extractors = filterExtractors(enabledExtractors, disabledExtractors, allExtractors);
      await runAnalysis(codebasePathResolved, outputPathResolved, extractors);
    } catch (error) {
      console.error('Fatal error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse(process.argv);

function filterExtractors(
  enabledExtractors: Set<string>,
  disabledExtractors: Set<string>,
  extractors: Extractor[],
): Extractor[] {
  if (enabledExtractors.size > 0) {
    extractors = extractors.filter((e) => enabledExtractors.has(e.name));
  }

  if (disabledExtractors.size > 0) {
    extractors = extractors.filter((e) => !disabledExtractors.has(e.name));
  }

  return extractors;
}

async function runAnalysis(codebasePath: string, outputPath: string, extractors: Extractor[]): Promise<void> {
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
