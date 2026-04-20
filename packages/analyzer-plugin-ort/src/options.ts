import { z } from 'zod';

/**
 * Options for ORT extractor.
 */
export const optionSchema = z.strictObject({
  /**
   * If true, use the definition_file_path from ORT projects as evidence (e.g., package.json, build.gradle).
   * If false (default), use the analyzer-result.json file as evidence.
   */
  useDefinitionFilePaths: z.boolean().optional(),
});

export type OrtOptions = z.infer<typeof optionSchema>;
