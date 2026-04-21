import { z } from 'zod';

/**
 * Options for Maven extractor.
 */
export const optionSchema = z.strictObject({
  ignore: z.array(z.string()).optional(),
  javaHome: z.string().optional(),
  mavenPath: z.string().optional(),
});

export type MavenOptions = z.infer<typeof optionSchema>;
