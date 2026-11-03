import {
  filesExtractor,
  mergeIgnorePatterns,
  readTextFile,
  runCommand,
  scanFiles,
} from "@scatool/analyzer-core";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionSchema, type GradleOptions } from "./options.ts";
import { convertGradleConfigurations, type ProjectInfo } from "./converter.ts";

// Retain the existing module API while conversion stays independent of process execution.
export { convertGradleConfigurations, type GradleConfiguration } from "./converter.ts";

// Keep asset lookup beside the extractor in both source and bundled dist output.
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const extractor = filesExtractor<GradleOptions>({
  name: "gradle",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    for (const file of await scanFiles(
      codebase,
      "**/build.gradle{,.kts}",
      mergeIgnorePatterns(this, options.ignore),
    ))
      if (existsSync(join(dirname(file), process.platform === "win32" ? "gradlew.bat" : "gradlew")))
        this.markFile(file);
  },
  extractFile: async (file, options, context) => {
    const projectDirectory = dirname(file);
    const wrapper = join(
      projectDirectory,
      process.platform === "win32" ? "gradlew.bat" : "gradlew",
    );
    const processEnvironment = {
      ...process.env,
      ...(options.javaHome && { JAVA_HOME: options.javaHome }),
    };

    // Read project identity and source paths before requesting the dependency snapshot.
    const metadataOutput = await runCommand(
      [wrapper, "-I", join(moduleDir, "project-info.gradle"), "-q"],
      { cwd: projectDirectory, env: processEnvironment },
    );
    if (metadataOutput.exitCode !== 0)
      throw new Error(`Gradle project metadata extraction failed: ${metadataOutput.stderr}`);

    const projects = parseProjectMetadata(metadataOutput.stdout, context.codebasePath);

    const dependencyOutput = await runCommand(
      [
        wrapper,
        "-I",
        join(moduleDir, "init.gradle"),
        "--no-configuration-cache",
        "--no-configure-on-demand",
        ":ForceDependencyResolutionPlugin_resolveAllDependencies",
      ],
      { cwd: projectDirectory, env: processEnvironment },
    );
    if (dependencyOutput.exitCode !== 0)
      throw new Error(`Gradle dependency extraction failed: ${dependencyOutput.stderr}`);

    const configurations = JSON.parse(
      await readTextFile(
        join(projectDirectory, "build/reports/dependency-graph-snapshots/dependency-graph.json"),
      ),
    );

    return convertGradleConfigurations(
      configurations,
      projects,
      context.relativeFile,
      context.codebaseId,
    );
  },
});

/** Rebase project references before graph IDs are derived from their content. */
function parseProjectMetadata(stdout: string, codebasePath: string): Record<string, ProjectInfo> {
  const projects: Record<string, ProjectInfo> = {};
  const codebasePrefix = `${codebasePath.replaceAll("\\", "/").replace(/\/$/, "")}/`;

  for (const match of stdout.matchAll(
    /===PROJECT_INFO_START===\s*([\s\S]*?)\s*===PROJECT_INFO_END===/g,
  )) {
    const block = JSON.parse(match[1]!) as Record<string, ProjectInfo>;
    // Graph IDs content-address their project references. Rebase native paths
    // before creating graphs, not only in the outer files-extractor wrapper.
    for (const info of Object.values(block)) {
      if (info.buildFile !== undefined) {
        const normalized = info.buildFile.replaceAll("\\", "/");
        info.buildFile = normalized.startsWith(codebasePrefix)
          ? normalized.slice(codebasePrefix.length)
          : normalized;
      }
    }

    if (Object.keys(block).length === 1 && block[":"]?.name === "buildSrc")
      projects[":buildSrc"] = block[":"];
    else Object.assign(projects, block);
  }

  return projects;
}
