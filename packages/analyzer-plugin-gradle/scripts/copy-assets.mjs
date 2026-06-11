import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const sourceDir = join(process.cwd(), "src");
const targetDir = join(process.cwd(), "dist");
const entries = await readdir(sourceDir);
const gradleFiles = entries.filter((entry) => entry.endsWith(".gradle"));

await mkdir(targetDir, { recursive: true });

await Promise.all(
  gradleFiles.map((file) => copyFile(join(sourceDir, file), join(targetDir, file))),
);
