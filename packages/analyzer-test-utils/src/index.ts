import type { AnalyzerResult, Extractor } from '@scatool/analyzer-core';
import { Glob } from 'bun';
import { expect, test } from 'bun:test';
import { join } from 'node:path';

/**
 * Normalizes paths in an AnalyzerResult for snapshot testing.
 * As of the relative paths update, this function is now a no-op since paths
 * are already relative to the codebase. Kept for backward compatibility.
 *
 * @param result - The AnalyzerResult to normalize (will be mutated)
 * @param basePath - No longer used, kept for API compatibility
 * @param replacement - No longer used, kept for API compatibility
 * @returns The normalized result (same object, returned for convenience)
 *
 * @example
 * const result = await extractor.extract(fixturePath);
 * normalizeResult(result, fixturesDir);
 * expect(result).toMatchSnapshot();
 */
export function normalizeResult(result: AnalyzerResult, _basePath?: string, _replacement?: string): AnalyzerResult {
  // Paths are now relative to the codebase, so no normalization needed
  return result;
}

/**
 * Scans a fixtures directory for subdirectories containing files matching a pattern.
 *
 * @param fixturesDir - The base fixtures directory to scan
 * @param pattern - The glob pattern to match (e.g., '* /bun.lock', '* /{package-lock.json,npm-shrinkwrap.json}')
 * @returns A sorted array of fixture directory names
 *
 * @example
 * const fixtures = await scanFixtures(fixturesDir, '* /bun.lock');
 * // Returns: ['basic', 'monorepo', 'workspace']
 *
 * @example
 * const fixtures = await scanFixtures(fixturesDir, '* /{package-lock.json,npm-shrinkwrap.json}');
 * // Returns: ['basic', 'lockfile-v1', 'monorepo']
 */
export async function scanFixtures(fixturesDir: string, pattern: string): Promise<string[]> {
  const glob = new Glob(pattern);
  const fixtures = new Set<string>();

  for await (const file of glob.scan({ cwd: fixturesDir })) {
    // Extract directory name from path (e.g., "basic/bun.lock" -> "basic")
    const dir = file.split('/')[0];
    if (dir) {
      fixtures.add(dir);
    }
  }

  // Sort fixtures alphabetically for consistent test ordering
  return Array.from(fixtures).sort();
}

/**
 * Scans a fixtures directory for files matching a pattern.
 * Unlike scanFixtures, this returns file paths, not directory names.
 *
 * @param fixturesDir - The base fixtures directory to scan
 * @param pattern - The glob pattern to match (e.g., 'Dockerfile.*', '*.yml')
 * @returns A sorted array of file paths relative to fixturesDir
 *
 * @example
 * const files = await scanFixtureFiles(fixturesDir, 'Dockerfile.*');
 * // Returns: ['Dockerfile.alpine', 'Dockerfile.multi-stage']
 */
export async function scanFixtureFiles(fixturesDir: string, pattern: string): Promise<string[]> {
  const glob = new Glob(pattern);
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: fixturesDir })) {
    files.push(file);
  }

  // Sort files alphabetically for consistent test ordering
  return files.sort();
}

/**
 * Creates standardized tests for an extractor using fixtures.
 * This helper reduces boilerplate by automating the common pattern of:
 * 1. Scanning for fixtures
 * 2. Running the extractor on each fixture
 * 3. Normalizing paths
 * 4. Comparing against snapshots
 *
 * @param options - Configuration for the test factory
 * @param options.extractor - The extractor to test
 * @param options.fixturesDir - Directory containing test fixtures
 * @param options.pattern - Glob pattern to find fixture directories/files
 * @param options.useFiles - If true, uses scanFixtureFiles instead of scanFixtures (default: false)
 *
 * @example
 * // In your test file:
 * import { extractor } from './index.ts';
 * import { createExtractorTests } from '@scatool/analyzer-test-utils';
 * import { join } from 'node:path';
 *
 * const fixturesDir = join(import.meta.dir, '__fixtures__');
 *
 * createExtractorTests({
 *   extractor,
 *   fixturesDir,
 *   pattern: '* /bun.lock',
 * });
 */
export async function createExtractorTests(options: {
  extractor: Extractor;
  fixturesDir: string;
  pattern: string;
  useFiles?: boolean;
}): Promise<void> {
  const { extractor, fixturesDir, pattern, useFiles = false } = options;

  // Scan for fixtures
  const fixtures = useFiles ? await scanFixtureFiles(fixturesDir, pattern) : await scanFixtures(fixturesDir, pattern);

  // Create a test for each fixture
  for (const fixture of fixtures) {
    test(fixture, async () => {
      const fixturePath = useFiles ? join(fixturesDir, fixture) : join(fixturesDir, fixture);
      const result = await extractor.extract(fixturePath);
      normalizeResult(result, fixturesDir);
      expect(result).toMatchSnapshot();
    });
  }
}
