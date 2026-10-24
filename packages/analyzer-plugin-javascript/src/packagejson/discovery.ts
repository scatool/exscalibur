import { dirname, join } from "node:path/posix";
import { existsSync } from "node:fs";

export function hasLockfileInDirectory(dir: string, codebase: string): boolean {
  const lockfiles = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
  ];

  // Check current directory and all parent directories up to the codebase root
  let currentDir = dir;
  while (currentDir.startsWith(codebase)) {
    for (const lockfile of lockfiles) {
      if (existsSync(join(currentDir, lockfile))) {
        return true;
      }
    }

    // Move to parent directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return false;
}
