import { z } from 'zod';

/**
 * Options for Gradle extractor.
 */
export const optionSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for build files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/build/**', '**\/gradle/**']
   */
  ignore: z.array(z.string()).optional(),

  /**
   * Path to the Java home directory.
   * If not specified, the JAVA_HOME environment variable will be used.
   */
  javaHome: z.string().optional(),
});

export type GradleOptions = z.infer<typeof optionSchema>;
