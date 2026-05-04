import { z } from 'zod';

/**
 * Options for the vcpkg extractor.
 */
export const optionsSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for lockfiles/package files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/build\/**']
   */
  ignore: z.array(z.string()).default(['**/build/**']),

  /**
   * Path to the vcpkg binary.
   * @default 'vcpkg'
   */
  vcpkgPath: z.string().default('vcpkg'),

  /**
   * Additional arguments to pass to the "vcpkg depend-info" command.
   * This can be used to provide extra flags or options that are not explicitly supported
   * by the other configuration fields.
   */
  vcpkg_args: z.array(z.string()).optional(),
});

export type VcpkgOptions = z.infer<typeof optionsSchema>;
