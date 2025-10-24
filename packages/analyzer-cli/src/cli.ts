#!/usr/bin/env bun

import { bunlockExtractor, packageJsonExtractor, packageLockJsonExtractor, pnpmLockExtractor } from '@scatool/analyzer-plugin-javascript/src/index.ts';
import { dockerfileExtractor } from '@scatool/analyzer-plugin-containers/src/index.ts';
import { extractor as githubActionsExtractor } from '@scatool/analyzer-plugin-github-actions/src/index.ts';
import type { AnalyzerResult, Extractor } from '@scatool/analyzer-core/src/index.ts';
import { resolve } from 'path';

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: analyzer <codebase-path> <output-path>');
  console.error('');
  console.error('Arguments:');
  console.error('  codebase-path  Path to the codebase to analyze');
  console.error('  output-path    Path to write the JSON output file');
  process.exit(1);
}

const codebasePath = resolve(args[0]);
const outputPath = resolve(args[1]);

// All available extractors
const extractors: Extractor[] = [
  bunlockExtractor,
  packageJsonExtractor,
  packageLockJsonExtractor,
  pnpmLockExtractor,
  dockerfileExtractor,
  githubActionsExtractor,
];

async function runAnalysis(): Promise<void> {
  console.error('Running analysis...');
  console.error(`Codebase: ${codebasePath}`);
  console.error(`Output: ${outputPath}`);
  console.error('');

  // Run all extractors
  const results: AnalyzerResult[] = [];

  for (const extractor of extractors) {
    try {
      console.error(`Running extractor (version ${extractor.version})...`);
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
