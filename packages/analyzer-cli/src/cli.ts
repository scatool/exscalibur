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
import { extractor as spdxExtractor } from '@scatool/analyzer-plugin-spdx/src/index.ts';
import { ortExtractor } from '@scatool/analyzer-plugin-ort/src/index.ts';
import type { AnalyzerResult, Extractor } from '@scatool/analyzer-core/src/index.ts';
import { resolve } from 'path';
import { z } from 'zod';

type ExtractorOptions = Record<string, unknown>;

function parseExtractorOptions(optionStrings: string[], existingOptions: ExtractorOptions): ExtractorOptions {
  const result: ExtractorOptions = { ...existingOptions };

  for (const optionString of optionStrings) {
    const keyValueParts = optionString.split('=');
    if (keyValueParts.length !== 2) {
      throw new Error(`Invalid extractor option format: "${optionString}". Expected format: extractor.option=value`);
    }

    const [keyName, optionValue] = keyValueParts;
    const keyParts = keyName.split('.');

    let parsedOptionValue;
    try {
      parsedOptionValue = JSON.parse(optionValue);
    } catch (e) {
      throw new Error(`Option value for ${keyName} could not be parsed as JSON value: ${optionValue}`, { cause: e });
    }

    // stage 1: create all non existing objects (follow the path)
    let currObj: Record<string, unknown> = result;
    for (const keyPart of keyParts.slice(0, -1)) {
      if (!currObj[keyPart]) {
        currObj[keyPart] = {};
      }
      if (typeof currObj[keyPart] !== 'object' || Array.isArray(currObj[keyPart])) {
        console.error(
          `Warning: Overwriting non-object value at "${keyPart}" to create nested extractor option for "${keyName}". ` +
            `Previous value: ${JSON.stringify(currObj[keyPart])}, new value: {}`,
        );
        currObj[keyPart] = {};
      }
      currObj = currObj[keyPart] as Record<string, unknown>;
    }

    // stage 2: set the value to the corresponding object
    if (currObj[keyParts[keyParts.length - 1]] !== undefined) {
      console.error(
        `Warning: Overwriting existing value for extractor option "${keyName}". Previous value: ${JSON.stringify(
          currObj[keyParts[keyParts.length - 1]],
        )}, new value: ${JSON.stringify(parsedOptionValue)}`,
      );
    }
    currObj[keyParts[keyParts.length - 1]] = parsedOptionValue;
  }

  return result;
}

function validateOptions(extractors: Extractor[], parsedOptions: ExtractorOptions) {
  // Instead of validating each extractor options separately, we construct a combined schema for all extractors
  // and validate the entire options object at once -> better error messages
  const tmpSchemas: Record<string, z.ZodType> = {};

  for (const extractor of extractors) {
    if (extractor.optionsSchema) {
      tmpSchemas[extractor.name] = extractor.optionsSchema.optional();
    }
  }

  const topLevelSchema = z.strictObject(tmpSchemas);
  topLevelSchema.parse(parsedOptions);
}

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
  .option(
    '--extractor-options <options>',
    'Pass options to extractors (format: extractor.option=[JSON value], can be repeated. ' +
      'Example: --extractor-options \'packagejson.ignore=["**/node_modules/**", "**/additional_dir/**"]\')',
    (value: string, previous: string[] | undefined) => {
      return previous ? [...previous, value] : [value];
    },
    [] as string[],
  )
  .option<ExtractorOptions>(
    '--extractor-options-json <json>',
    'Pass options to extractors as a JSON string (format: {"extractor": {"option": value}}. ' +
      'Example: --extractor-options-json \'{"packagejson":{"ignore":["**/node_modules/**", "**/additional_dir/**"]}}\'',
    (value: string) => {
      try {
        const res = JSON.parse(value);
        if (typeof res !== 'object' || Array.isArray(res) || res === null) {
          console.error(`Invalid value given for --extractor-options-json: '${value}' has to be an object`);
          process.exit(1);
        }
        return res as ExtractorOptions;
      } catch (e) {
        console.error(
          'Failed to parse JSON for --extractor-options-json: ' + (e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
      }
    },
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
  spdx              Extract from SPDX 3.0.x JSON-LD files
  ort               Extract from ORT result files

Examples:
  analyzer /repo /output.json
  analyzer --enable packagejson,bunlock /repo /output.json
  analyzer --disable gradle,maven /repo /output.json
  analyzer --extractor-options 'packagejson.ignore=["**/node_modules/**", "**/additional_dir/**"]' /repo /output.json
  analyzer --extractor-options-json '{"packagejson":{"ignore":["**/node_modules/**", "**/additional_dir/**"]}}' /repo /output.json
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
        spdxExtractor,
        ortExtractor,
      ];

      const extractors = filterExtractors(enabledExtractors, disabledExtractors, allExtractors);

      // Parse and validate extractor options
      let parsedOptions: ExtractorOptions = options.extractorOptionsJson || {};

      if ((options.extractorOptions as string[]).length > 0) {
        parsedOptions = parseExtractorOptions(options.extractorOptions as string[], parsedOptions);
      }

      // just validate the options here
      // the default options are merged later by each call to Extractor.extract
      try {
        validateOptions(extractors, parsedOptions);
      } catch (error) {
        if (error instanceof z.ZodError) {
          console.error('Error validating extractor options!');
          console.error(`Parsed cli options: ${JSON.stringify(parsedOptions, null, 2)}\n`);
          console.error(z.prettifyError(error));
        } else {
          console.error(
            'Error parsing & validating extractor options:',
            error instanceof Error ? error.message : String(error),
          );
        }
        process.exit(1);
      }

      await runAnalysis(codebasePathResolved, outputPathResolved, extractors, parsedOptions);
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

async function runAnalysis(
  codebasePath: string,
  outputPath: string,
  extractors: Extractor[],
  options: ExtractorOptions,
): Promise<void> {
  console.error('Running analysis...');
  console.error(`Codebase: ${codebasePath}`);
  console.error(`Output: ${outputPath}`);
  console.error(`Active extractors: ${extractors.map((e) => e.name).join(', ')}`);
  console.error('');

  const results: AnalyzerResult[] = [];

  for (const extractor of extractors) {
    try {
      console.error(`Running ${extractor.name} extractor (version ${extractor.version})...`);
      const extractorOptions = options[extractor.name] as Partial<unknown> | undefined;
      const result = await extractor.extract(codebasePath, extractorOptions);
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
