import { scanAndMarkFiles, type MarkFileContext } from "@scatool/analyzer-core";
import type { ConanOptions } from "./options.ts";

export async function markFiles(this: MarkFileContext, codebase: string, options: ConanOptions) {
  for (const pattern of options.conanFiles) {
    await scanAndMarkFiles(this, codebase, pattern, options.ignore);
  }
}
