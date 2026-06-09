import type { VcpkgPort } from './types.ts';

export type VcpkgPortInfoResult = Record<string, VcpkgPort>;

export async function retrievePortInfo(
  portNames: string[],
  vcpkgFileDir: string,
  vcpkgPath: string,
): Promise<VcpkgPortInfoResult> {
  const cmd = [vcpkgPath, 'x-package-info', '--x-json', ...portNames];
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: vcpkgFileDir,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 1) {
    throw new Error(`"${cmd.join(' ')}" failed with exit code ${exitCode}: ${await proc.stderr.text()}`);
  }

  const parsed: VcpkgPortInfoResult = (await proc.stdout.json()).results;
  return parsed;
}
