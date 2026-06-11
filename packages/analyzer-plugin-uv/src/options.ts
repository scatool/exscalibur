import { z } from "zod";

/**
 * Options for UV extractor.
 */
export const optionSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for uv.lock files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/node_modules\/**', '**\/.venv\/**']
   */
  ignore: z.array(z.string()).default(["**/node_modules/**", "**/.venv/**"]),

  /**
   * Path to the uv binary.
   * Defaults to: uv
   */
  uvPath: z.string().default("uv"),
});

export type UvOptions = z.infer<typeof optionSchema>;
