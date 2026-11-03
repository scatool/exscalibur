import { scanAndMarkFiles, type MarkFileContext } from "@scatool/analyzer-core";
import type { VcpkgOptions } from "./options.ts";
import type { VcpkgPort } from "./types.ts";

export async function markFiles(this: MarkFileContext, codebase: string, options: VcpkgOptions) {
  await scanAndMarkFiles(this, codebase, "**/vcpkg.json", options.ignore);
}

export function portToVersion(port: VcpkgPort): string | undefined {
  return port.version ?? port["version-date"] ?? port["version-semver"] ?? port["version-string"];
}
