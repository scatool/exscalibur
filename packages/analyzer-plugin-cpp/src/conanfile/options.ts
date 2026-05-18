import { z } from 'zod';

/**
 * Options for the Conan extractor.
 */
export const optionsSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for lockfiles/package files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/build\/**']
   */
  ignore: z.array(z.string()).default(['**/build/**']),

  /**
   * Path to the conan binary.
   * @default 'conan'
   */
  conanPath: z.string().default('conan'),

  /**
   * Conan build profile passed to `conan graph info` as `--profile:build`.
   */
  profileBuild: z.string().optional(),

  /**
   * Conan host profile passed to `conan graph info` as `--profile:host`.
   */
  profileHost: z.string().optional(),

  /**
   * Additional arguments to pass to the conan command.
   * This can be used to provide extra flags or options that are not explicitly supported
   * by the other configuration fields.
   */
  conanArgs: z.array(z.string()).optional(),

  /**
   * Glob patterns to identify conanfiles.
   * @default `[**\/conanfile.{txt,py}]`.
   */
  conanFiles: z.array(z.string()).default(['**/conanfile.{txt,py}']),
});

export type ConanOptions = z.infer<typeof optionsSchema>;
