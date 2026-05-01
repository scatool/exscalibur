import { z } from 'zod';

/**
 * Options for Maven extractor.
 */
export const optionSchema = z.strictObject({
  ignore: z.array(z.string()).default(['**/target/**', '**/.mvn/**']),
  javaHome: z.string().optional(),
  mavenPath: z.string().default('mvn'),
});

export type MavenOptions = z.infer<typeof optionSchema>;
