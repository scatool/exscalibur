import { z } from "zod";

/**
 * Options for Python ecosystem extractors.
 */
export const optionSchema = z.strictObject({
  /**
   * Glob patterns to ignore when scanning for Python lockfiles.
   * Defaults are defined on a per-extractor basis.
   */
  ignore: z
    .array(z.string())
    .default(["**/.venv/**", "**/venv/**", "**/__pycache__/**", "**/__pypackages__/**"]),
});

export type PythonOptions = z.infer<typeof optionSchema>;
