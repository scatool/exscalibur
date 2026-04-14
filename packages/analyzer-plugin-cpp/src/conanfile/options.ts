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
  ignore: z.array(z.string()).optional(),

  /**
   * Path to the conan binary.
   * @default 'conan'
   */
  conan_path: z.string().optional(),

  /**
   * Conan build profile passed to `conan graph info` as `--profile:build`.
   */
  profile_build: z.string().optional(),

  /**
   * Conan host profile passed to `conan graph info` as `--profile:host`.
   */
  profile_host: z.string().optional(),

  /**
   * Additional arguments to pass to the conan command.
   * This can be used to provide extra flags or options that are not explicitly supported
   * by the other configuration fields.
   */
  conan_args: z.array(z.string()).optional(),
});

export type ConanOptions = z.infer<typeof optionsSchema>;
