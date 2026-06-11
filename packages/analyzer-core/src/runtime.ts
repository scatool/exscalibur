import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, sep } from "node:path";
import fg from "fast-glob";

export async function readTextFile(file: string): Promise<string> {
  return readFile(file, "utf8");
}

export async function readNormalizedTextFile(file: string): Promise<string> {
  return (await readTextFile(file)).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
}

export async function writeTextFile(file: string, content: string): Promise<void> {
  await writeFile(file, content);
}

export async function scanFiles(
  codebase: string,
  pattern: string,
  ignorePatterns: string[] = [],
): Promise<string[]> {
  const files = await fg(pattern, {
    cwd: codebase,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: ignorePatterns,
  });

  return files.map((file) => file.replaceAll("\\", "/")).sort();
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: "pipe" | "inherit";
  stderr?: "pipe" | "inherit";
}

export interface RunCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const [executable, ...args] = command;
  if (!executable) {
    throw new Error("Cannot run an empty command");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [
        "ignore",
        options.stdout === "inherit" ? "inherit" : "pipe",
        options.stderr === "inherit" ? "inherit" : "pipe",
      ],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export function findExecutable(command: string): string | undefined {
  if (command.includes("/") || command.includes("\\")) {
    return canExecute(command) ? command : undefined;
  }

  const path = process.env.PATH;
  if (!path) {
    return undefined;
  }

  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const directory of path.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = `${directory}${sep}${command}${extension}`;
      if (canExecute(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function canExecute(file: string): boolean {
  if (!existsSync(file)) {
    return false;
  }

  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
