import type { AnalyzerResult } from '@scatool/analyzer-core';
import { Glob } from 'bun';

/**
 * Normalizes paths in an AnalyzerResult for snapshot testing.
 * Replaces a base path (typically fixturesDir) with a placeholder (typically '<fixtures>')
 * in both package evidence and subproject definition files.
 *
 * @param result - The AnalyzerResult to normalize (will be mutated)
 * @param basePath - The path to replace (e.g., '/path/to/fixtures')
 * @param replacement - The replacement string (default: '<fixtures>')
 * @returns The normalized result (same object, mutated for convenience)
 *
 * @example
 * const result = await extractor.extract(fixturePath);
 * normalizeResult(result, fixturesDir);
 * expect(result).toMatchSnapshot();
 */
export function normalizeResult(
  result: AnalyzerResult,
  basePath: string,
  replacement: string = '<fixtures>',
): AnalyzerResult {
  // Normalize paths in package evidence
  for (const pkg of result.packages) {
    pkg.evidence = pkg.evidence.map((e: string) => e.replace(basePath, replacement));
  }

  // Normalize paths in subproject definition files
  for (const subproject of result.subprojects) {
    subproject.definitionFile = subproject.definitionFile.replace(basePath, replacement);
  }

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
