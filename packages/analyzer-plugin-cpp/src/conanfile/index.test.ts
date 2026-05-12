import { join } from 'node:path';
import { createExtractorTests } from '@scatool/analyzer-test-utils';
import { filesExtractor } from '@scatool/analyzer-core';
import { type ConanOptions, optionsSchema } from './options.ts';
import { extractFile, markFiles } from './conanfile.ts';
import { PackageURL } from 'packageurl-js';

/*
 * NOTE: There are several challenges with providing a reproducible testsuite for conan
 *
 * 1. With conan, the actual dependencies/output of recipes (= packages) may vary on different architectures and compiler (versions).
 *    This would mean that the rref (which is is a unique hash that identifies a specific version of a recipe file) may not match anymore.
 *    => This is solved by providing a constant profile (__fixtures__/profile) for both the host and the target build
 *       (see default "options" below)
 *    => Also: Recipes with obvious platform differences are avoided
 * 2. In conan, many old versions of recipes are still maintained
 *    (see check boxes/warning symbols in the "versions" tag, e.g. in https://conan.io/center/recipes/openssl).
 *    Therefore, the rrefs for maintained recipes may change at any time (e.g. due to patches).
 *    => Use only unmaintained recipes
 *    => For transitive tests, where also transitive dependencies are still maintained: use conan's lock files
 *
 * If these constraints still seem not to suffice, removing rrefs from the tests is possible as well.
 * To do this, simply set `disableRRefs` to `true` and regenerate the `__snapshots__` directory.
 */
const disableRRefs: boolean = false;

const fixturesDir = join(import.meta.dir, '__fixtures__');

const extractorWrapper = filesExtractor<ConanOptions>({
  name: 'conanfile-test-wrapper',
  version: 1,
  options: async () => {
    // override profile paths to ensure reproducible test results
    return {
      profile_build: join(fixturesDir, 'profile'),
      profile_host: join(fixturesDir, 'profile'),
    };
  },
  optionsSchema: optionsSchema,
  markFiles: markFiles,
  extractFile: async (file: string, options: ConanOptions) => {
    const res = await extractFile(file, options);

    // remove warnings, as they are not stable and not relevant for the tests
    res.issues = res.issues?.filter((issue) => issue.severity !== 'WARNING');

    if (disableRRefs) {
      const removeRRefFromPurl = (purlStr: string) => {
        const purl = PackageURL.fromString(purlStr);
        if (purl.qualifiers && purl.qualifiers.rrev) {
          purl.qualifiers['rrev'] = '00000000000000000000000000000000';
        }
        console.log(`Original purl: ${purlStr}, modified purl: ${purl.toString()}`);
        return purl.toString();
      };

      res.packages.forEach((pkg) => {
        pkg.purl = removeRRefFromPurl(pkg.purl);
      });

      res.relationships.forEach((rel) => {
        rel.from = removeRRefFromPurl(rel.from);
        rel.to = rel.to.map(removeRRefFromPurl);
      });

      res.subprojects.forEach((subproject) => {
        subproject.purl = removeRRefFromPurl(subproject.purl);
        subproject.scopes.forEach((scope) => {
          scope.packages = scope.packages.map(removeRRefFromPurl);
        });
      });
    }

    return res;
  },
});

await createExtractorTests({
  extractor: extractorWrapper,
  fixturesDir,
  pattern: '*/conanfile.{txt,py}',
  timeout: 30000, // transitive example can take a while to analyze
});
