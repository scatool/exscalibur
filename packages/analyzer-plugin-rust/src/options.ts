import { z } from 'zod';

export const optionSchema = z.strictObject({
  /**
   * Glob patterns for files/directories to ignore during extraction.
   * Defaults to: target/ (Cargo's build output directory).
   *
   * @example ignore: [**\/target/, **\/vendor/]
   */
  ignore: z.array(z.string()).optional(),
});

export type RustOptions = z.infer<typeof optionSchema>;
