import {
  normalizeResult,
  readNormalizedTextFile,
  scanFiles,
  type AnalyzerResult,
  type Extractor,
} from "@scatool/analyzer-core";
import { expect, test } from "vitest";
import { dirname, join } from "node:path/posix";
import { assertSuccessfulResult } from "./validate.ts";

export { validateResult, assertSuccessfulResult } from "./validate.ts";

type SemanticCheck = {
  /** Assert facts supported by the native fixture, beyond structural validation. */
  assertResult: (result: AnalyzerResult, fixture: string) => void | Promise<void>;
  /** Explicitly expected fixture error codes; all other ERROR issues fail the test. */
  allowedIssueCodes?: string[];
};

export async function createFileContentTests(
  options: SemanticCheck & {
    extractFn: (content: string, filename: string) => AnalyzerResult | Promise<AnalyzerResult>;
    fixturesDir: string;
    pattern: string;
  },
): Promise<void> {
  for (const file of await scanFixtureFiles(options.fixturesDir, options.pattern)) {
    test(file, async () => {
      const content = await readNormalizedTextFile(join(options.fixturesDir, file));
      const result = await options.extractFn(content, file);

      assertSuccessfulResult(result, options.allowedIssueCodes);
      await options.assertResult(result, file);

      // Preserve the whole contextual result; semantic assertions explain its native meaning.
      expect(normalizeResult(result)).toMatchSnapshot();
    });
  }
}

export async function scanFixtures(fixturesDir: string, pattern: string): Promise<string[]> {
  const fixtures = new Set<string>();
  for (const file of await scanFixtureFiles(fixturesDir, pattern)) {
    const directory = file.split("/")[0];
    if (directory) fixtures.add(directory);
  }
  return [...fixtures].sort((a, b) => a.localeCompare(b));
}

export async function scanFixtureFiles(fixturesDir: string, pattern: string): Promise<string[]> {
  return (await scanFiles(fixturesDir, pattern))
    .map((file) => file.slice(fixturesDir.length + 1))
    .sort((a, b) => a.localeCompare(b));
}

/** Check native fixture semantics and guard the full normalized result against regressions. */
export async function createExtractorTests<Options>(
  options: SemanticCheck & {
    extractor: Extractor<Options>;
    fixturesDir: string;
    pattern: string;
    useFiles?: boolean;
    extractDirectory?: boolean;
    timeout?: number;
    namePrefix?: string;
    options?: Partial<Options>;
  },
): Promise<void> {
  const fixturesDir = options.fixturesDir.replaceAll("\\", "/");
  let fixtures = options.useFiles
    ? await scanFixtureFiles(fixturesDir, options.pattern)
    : await scanFixtures(fixturesDir, options.pattern);
  if (options.extractDirectory) fixtures = [...new Set(fixtures.map(dirname))];
  for (const fixture of fixtures) {
    test(
      options.namePrefix ? `${options.namePrefix} ${fixture}` : fixture,
      async () => {
        const result = await options.extractor.extract(
          join(fixturesDir, fixture),
          options.options,
          { codebaseId: "test:fixture" },
        );

        assertSuccessfulResult(result, options.allowedIssueCodes);
        await options.assertResult(result, fixture);

        expect(normalizeResult(result)).toMatchSnapshot();
      },
      options.timeout,
    );
  }
}
