import { z } from 'zod';

/**
 * Shared options for JavaScript ecosystem extractors.
 */
export const optionSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for lockfiles/package files.
   * Files matching any of these patterns will be excluded from extraction.
   */
  ignore: z.array(z.string()).optional(),
});

export type JavaScriptOptions = z.infer<typeof optionSchema>;
