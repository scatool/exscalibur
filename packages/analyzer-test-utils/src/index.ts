import type { Extractor } from '@scatool/analyzer-core';
import { Glob } from 'bun';
import { expect, test } from 'bun:test';
import { basename, dirname, join } from 'node:path/posix';
import { validateResult } from './validate.ts';

export { validateResult } from './validate.ts';

/**
 * Creates standardized tests for file content extraction functions.
 * This helper is for functions that extract from file content rather than directories.
 *
 * @param options - Configuration for the test factory
 * @param options.extractFn - Function that takes (content, filename) and returns AnalyzerResult
 * @param options.fixturesDir - Directory containing test fixtures
 * @param options.pattern - Glob pattern to find fixture files
 *
 * @example
 * import { extractDockerfile } from './index.ts';
 * import { createFileContentTests } from '@scatool/analyzer-test-utils';
 * import { join } from 'node:path/posix';
 *
 * const fixturesDir = join(import.meta.dir, '__fixtures__');
 *
 * await createFileContentTests({
 *   extractFn: extractDockerfile,
 *   fixturesDir,
 *   pattern: 'Dockerfile.*',
 * });
 */
export async function createFileContentTests(options: {
  extractFn: (
    content: string,
    filename: string,
  ) => import('@scatool/analyzer-core').AnalyzerResult | Promise<import('@scatool/analyzer-core').AnalyzerResult>;
  fixturesDir: string;
  pattern: string;
}): Promise<void> {
  const { extractFn, fixturesDir, pattern } = options;

  const fixtureFiles = await scanFixtureFiles(fixturesDir, pattern);

  for (const file of fixtureFiles) {
    test(file, async () => {
      const filePath = join(fixturesDir, file);
      const content = await Bun.file(filePath).text();
      const result = await extractFn(content, file);
      validateResult(result);
      expect(result).toMatchSnapshot();
    });
  }
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
    const dir = basename(dirname(file));
    if (dir) {
      fixtures.add(dir);
    }
  }

  // Sort fixtures alphabetically for consistent test ordering
  return Array.from(fixtures).sort((a, b) => a.localeCompare(b));
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
    files.push(file.replaceAll('\\', '/'));
  }

  // Sort files alphabetically for consistent test ordering
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Creates standardized tests for an extractor using fixtures.
 * This helper reduces boilerplate by automating the common pattern of:
 * 1. Scanning for fixtures
 * 2. Running the extractor on each fixture
 * 3. Validating the result
 * 4. Comparing against snapshots
 *
 * @param options - Configuration for the test factory
 * @param options.extractor - The extractor to test
 * @param options.fixturesDir - Directory containing test fixtures
 * @param options.pattern - Glob pattern to find fixture directories/files
 * @param options.useFiles - If true, uses scanFixtureFiles instead of scanFixtures (default: false)
 * @param options.extractDirectory - If true, extracts directory path from file paths (e.g., "npm/basic/file.json" -> "npm/basic") (default: false)
 * @param options.timeout - Test timeout in milliseconds (optional)
 *
 * @example
 * // In your test file:
 * import { extractor } from './index.ts';
 * import { createExtractorTests } from '@scatool/analyzer-test-utils';
 * import { join } from 'node:path/posix';
 *
 * const fixturesDir = join(import.meta.dir, '__fixtures__');
 *
 * createExtractorTests({
 *   extractor,
 *   fixturesDir,
 *   pattern: '* /bun.lock',
 * });
 *
 * @example
 * // For nested fixtures with files (e.g., ORT):
 * createExtractorTests({
 *   extractor,
 *   fixturesDir,
 *   pattern: '* /* /analyzer-result.json',
 *   useFiles: true,
 *   extractDirectory: true,
 * });
 */
export async function createExtractorTests(options: {
  extractor: Extractor;
  fixturesDir: string;
  pattern: string;
  useFiles?: boolean;
  extractDirectory?: boolean;
  timeout?: number;
}): Promise<void> {
  const { extractor, fixturesDir, pattern, useFiles = false, extractDirectory = false, timeout } = options;

  // Scan for fixtures
  let fixtures = useFiles ? await scanFixtureFiles(fixturesDir, pattern) : await scanFixtures(fixturesDir, pattern);

  // Extract directory paths if needed (e.g., "npm/basic/file.json" -> "npm/basic")
  if (extractDirectory) {
    fixtures = fixtures.map(dirname);
  }

  // Create a test for each fixture
  for (const fixture of fixtures) {
    test(
      fixture,
      async () => {
        const fixturePath = join(fixturesDir, fixture);
        const result = await extractor.extract(fixturePath);
        validateResult(result);
        expect(result).toMatchSnapshot();
      },
      timeout ? { timeout } : undefined,
    );
  }
}
