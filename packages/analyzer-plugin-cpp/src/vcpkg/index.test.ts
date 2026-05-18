import { join } from 'path/posix';
import { createExtractorTests } from '@scatool/analyzer-test-utils';
import { extractor as vcpkgExtractor } from './index.ts';
import type { VcpkgOptions } from './options';
import { test, expect } from 'bun:test';
import type { AnalyzerResult } from '@scatool/analyzer-core';

const fixturesDir = join(import.meta.dir, '__fixtures__');

/*
 * This file makes use of three different test styles:
 * 1. Snapshot tests for individual fixtures
 * 2. Individual tests for fixtures to ensure that certain properties hold (e.g., that the "simple" fixture is platform and feature independent)
 * 3. Compare extractor results with `vcpkg install --dry-run` and `vcpkg depend-info`, which serves as a "real-world" reference. Note that this can only be used to verify dependencies on the current platform.
 *
 * Reproducibility considerations:
 * For reproducible test results, it is crucial to ensure that the dependencies of the vcpkg.json files in the fixtures do not change over time.
 * This is achieved by setting the "builtin-baseline" to a specific git commit hash (see "vcpkg.json" files in the fixtures).
 * This way, even if the vcpkg ports repository is updated, the same versions of the dependencies will be used for the tests, ensuring stable and consistent test results.
 *
 * Note: If it becomes necessary to update the dependencies in the fixtures, the "builtin-baseline" can be updated to a newer commit hash.
 */

/*
 * To provide test coverage for different extraction scenarios (e.g., with/without features, different platforms),
 * multiple test runs with different extractor options are created for the fixtures.
 */
const testConfigs: {
  name: string;
  options: Partial<VcpkgOptions>;
}[] = [
  {
    name: '[all platforms & default features]',
    options: {
      includeAllFeatures: false,
    },
  },
  {
    name: '[all platforms & all features]',
    options: {
      includeAllFeatures: true,
    },
  },
  {
    name: '[linux-x64 platform & default features]',
    options: {
      includeAllFeatures: false,
      targetPlatform: {
        targetArchitecture: 'x64',
        cmakeSystemName: 'Linux',
        isNative: true,
      },
    },
  },
  {
    name: '[linux-x64 platform & all features]',
    options: {
      includeAllFeatures: true,
      targetPlatform: {
        targetArchitecture: 'x64',
        cmakeSystemName: 'Linux',
        isNative: true,
      },
    },
  },
];

// ############ 1. Snapshot tests for individual fixtures ############
for (const { name, options } of testConfigs) {
  await createExtractorTests({
    namePrefix: name,
    options,
    extractor: vcpkgExtractor,
    fixturesDir,
    pattern: '*/vcpkg.json',
    timeout: 30000,
  });
}

// ############ 2. Individual tests to ensure certain properties hold ############
function createEquivalenceClassTest(
  testName: string,
  fixture: string,
  eqClasses: { allHosts: boolean; allFeatures: boolean }[][],
) {
  test(testName, async () => {
    const fixturePath = join(fixturesDir, fixture);
    const results = await Promise.all(
      testConfigs.map(async (config) => ({
        config: {
          allHosts: config.options.targetPlatform === undefined,
          allFeatures: config.options.includeAllFeatures,
        },
        result: await vcpkgExtractor.extract(fixturePath, config.options),
      })),
    );

    function configurationToResult(toFind: { allHosts: boolean; allFeatures: boolean }): AnalyzerResult {
      return results.find(
        ({ config }) => config.allHosts === toFind.allHosts && config.allFeatures === toFind.allFeatures,
      )!.result;
    }

    // inside equivalence classes: tests for equality
    for (const eqClass of eqClasses) {
      for (const configuration of eqClass.slice(1)) {
        expect(configurationToResult(configuration)).toEqual(configurationToResult(eqClass[0]!));
      }
    }

    // outside equivalence classes: tests for inequality
    for (let i = 0; i < eqClasses.length; i++) {
      for (let j = i + 1; j < eqClasses.length; j++) {
        const configA = eqClasses[i]![0]!;
        const configB = eqClasses[j]![0]!;
        expect(configurationToResult(configA)).not.toEqual(configurationToResult(configB));
      }
    }
  });
}

createEquivalenceClassTest('simple fixture should be platform and feature independent', 'simple', [
  [
    { allHosts: true, allFeatures: false },
    { allHosts: true, allFeatures: true },
    { allHosts: false, allFeatures: false },
    { allHosts: false, allFeatures: true },
  ],
]);
createEquivalenceClassTest(
  'platform_dependent fixture should not be platform independent but feature independent',
  'platform_dependent',
  [
    [
      { allHosts: true, allFeatures: false },
      { allHosts: true, allFeatures: true },
    ],
    [
      { allHosts: false, allFeatures: false },
      { allHosts: false, allFeatures: true },
    ],
  ],
);
createEquivalenceClassTest(
  'transitive fixture should not be platform independent but feature independent',
  'transitive',
  [
    [
      { allHosts: true, allFeatures: false },
      { allHosts: true, allFeatures: true },
    ],
    [
      { allHosts: false, allFeatures: false },
      { allHosts: false, allFeatures: true },
    ],
  ],
);

// ############ 3. Verify extractor by using platform-dependent vcpkg commands ############
// TODO
