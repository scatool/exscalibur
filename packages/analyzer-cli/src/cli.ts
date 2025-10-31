#!/usr/bin/env bun

import {
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnLockExtractor,
} from '@scatool/analyzer-plugin-javascript/src/index.ts';
import { dockerfileExtractor } from '@scatool/analyzer-plugin-containers/src/index.ts';
import { extractor as githubActionsExtractor } from '@scatool/analyzer-plugin-github-actions/src/index.ts';
import type { AnalyzerResult, Extractor } from '@scatool/analyzer-core/src/index.ts';
import { resolve } from 'path';

// Parse command line arguments
const args = process.argv.slice(2);

// Parse flags
const enabledExtractors = new Set<string>();
const disabledExtractors = new Set<string>();
const positionalArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--enable' || arg === '-e') {
    // Next argument is the extractor name(s) - can be comma-separated
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
    // Next argument is the extractor name(s) - can be comma-separated
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
  console.error('  yarnlock          Extract from yarn.lock files');
  console.error('  dockerfile        Extract from Dockerfile files');
  console.error('  github-actions    Extract from GitHub Actions workflow files');
  process.exit(1);
}

const codebasePath = resolve(positionalArgs[0]);
const outputPath = resolve(positionalArgs[1]);

// All available extractors
const allExtractors: Extractor[] = [
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  yarnLockExtractor,
  dockerfileExtractor,
  githubActionsExtractor,
];

// Filter extractors based on enable/disable flags
function filterExtractors(extractors: Extractor[]): Extractor[] {
  // If --enable is used, only run the enabled extractors
  if (enabledExtractors.size > 0) {
    return extractors.filter((e) => enabledExtractors.has(e.name));
  }

  // If --disable is used, run all except the disabled extractors
  if (disabledExtractors.size > 0) {
    return extractors.filter((e) => !disabledExtractors.has(e.name));
  }

  // Otherwise, run all extractors
  return extractors;
}

const extractors = filterExtractors(allExtractors);

async function runAnalysis(): Promise<void> {
  console.error('Running analysis...');
  console.error(`Codebase: ${codebasePath}`);
  console.error(`Output: ${outputPath}`);
  console.error(`Active extractors: ${extractors.map((e) => e.name).join(', ')}`);
  console.error('');

  // Run all extractors
  const results: AnalyzerResult[] = [];

  for (const extractor of extractors) {
    try {
      console.error(`Running ${extractor.name} extractor (version ${extractor.version})...`);
      const result = await extractor.extract(codebasePath);
      results.push(result);
      console.error(`  Found ${result.packages.length} packages`);
      if (result.subprojects) {
        console.error(`  Found ${result.subprojects.length} subprojects`);
      }
      if (result.relationships) {
        console.error(`  Found ${result.relationships.length} relationships`);
      }
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.error('');
  console.error('Merging results...');

  // Merge all results
  const mergedResult = mergeResults(results);

  console.error(`Total packages: ${mergedResult.packages.length}`);
  if (mergedResult.subprojects) {
    console.error(`Total subprojects: ${mergedResult.subprojects.length}`);
  }
  if (mergedResult.relationships) {
    console.error(`Total relationships: ${mergedResult.relationships.length}`);
  }

  // Write output
  console.error('');
  console.error(`Writing output to ${outputPath}...`);
  await Bun.write(outputPath, JSON.stringify(mergedResult, null, 2));
  console.error('Done!');
}

function mergeResults(results: AnalyzerResult[]): AnalyzerResult {
  const packageMap = new Map<string, { purl: string; evidence?: string[] }>();
  const subprojects: Array<{
    purl: string;
    definitionFile: string;
    scopes?: Array<{ scope: string; packages: string[] }>;
  }> = [];
  const relationshipMap = new Map<string, Set<string>>();

  for (const result of results) {
    // Merge packages
    for (const pkg of result.packages) {
      const existing = packageMap.get(pkg.purl);
      if (existing) {
        // Merge evidence arrays
        if (pkg.evidence) {
          if (existing.evidence) {
            existing.evidence.push(...pkg.evidence);
          } else {
            existing.evidence = [...pkg.evidence];
          }
        }
      } else {
        // Create new entry
        const newPkg: { purl: string; evidence?: string[] } = { purl: pkg.purl };
        if (pkg.evidence) {
          newPkg.evidence = [...pkg.evidence];
        }
        packageMap.set(pkg.purl, newPkg);
      }
    }

    // Merge subprojects
    if (result.subprojects) {
      subprojects.push(...result.subprojects);
    }

    // Merge relationships
    if (result.relationships) {
      for (const rel of result.relationships) {
        const existing = relationshipMap.get(rel.from);
        if (existing) {
          for (const to of rel.to) {
            existing.add(to);
          }
        } else {
          relationshipMap.set(rel.from, new Set(rel.to));
        }
      }
    }
  }

  const merged: AnalyzerResult = {
    packages: Array.from(packageMap.values()),
  };

  if (subprojects.length > 0) {
    merged.subprojects = subprojects;
  }

  if (relationshipMap.size > 0) {
    merged.relationships = Array.from(relationshipMap.entries()).map(([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    }));
  }

  return merged;
}

// Run the analysis
try {
  await runAnalysis();
} catch (error) {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
