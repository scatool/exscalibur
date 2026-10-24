import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  const codebasePath = resolve(codebase);
  let currentDir = resolve(dir);
  while (true) {
    const fromCodebase = relative(codebasePath, currentDir);
    if (fromCodebase === ".." || fromCodebase.startsWith(`..${sep}`) || isAbsolute(fromCodebase)) {
      break;
    }
    for (const lockfile of lockfiles) {
      if (existsSync(join(currentDir, lockfile))) {
        return true;
      }
    }
    if (fromCodebase === "") break;

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
