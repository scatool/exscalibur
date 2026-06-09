import { runCommand } from "@scatool/analyzer-core";
import type { VcpkgPort } from "./types.ts";

export type VcpkgPortInfoResult = Record<string, VcpkgPort>;

export async function retrievePortInfo(
  portNames: string[],
  vcpkgFileDir: string,
  vcpkgPath: string,
): Promise<VcpkgPortInfoResult> {
  const cmd = [vcpkgPath, "x-package-info", "--x-json", ...portNames];
  const { exitCode, stdout, stderr } = await runCommand(cmd, { cwd: vcpkgFileDir });
  if (exitCode !== 1) {
    throw new Error(`"${cmd.join(" ")}" failed with exit code ${exitCode}: ${stderr}`);
  }

  const parsed: VcpkgPortInfoResult = JSON.parse(stdout).results;
  return parsed;
}
