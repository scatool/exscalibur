import { z } from 'zod';

/**
 * Options for Python ecosystem extractors.
 */
export const optionSchema = z.strictObject({
  /**
   * Glob patterns to ignore when scanning for Python lockfiles
   */
  ignore: z.array(z.string()).optional(),
});

export type PythonOptions = z.infer<typeof optionSchema>;
