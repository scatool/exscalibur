import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  addPackageEvidence,
  buildResult,
  initializeExtractionMaps,
  readTextFile,
  runCommand,
  scanFiles,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { dirname, join } from "node:path/posix";
import { dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { GradleOptions } from "./options.ts";
import { optionSchema } from "./options.ts";

const moduleDir = pathDirname(fileURLToPath(import.meta.url)).replaceAll("\\", "/");

interface DependencyCoordinates {
  group: string;
  module: string;
  version: string;
}

interface DependencyNode {
  id: string;
  origin: {
    id: string;
    path: string;
  };
  isDirect: boolean;
  isProject: boolean;
  coordinates: DependencyCoordinates;
  repositoryUrl?: string;
  dependencies: string[];
}

interface ConfigurationGraph {
  rootOrigin: {
    id: string;
    path: string;
  };
  configurationName: string;
  scope: string;
  allDependencies: DependencyNode[];
}

type DependencyGraphOutput = ConfigurationGraph[];

export const extractor: Extractor<GradleOptions> = filesExtractor<GradleOptions>({
  name: "gradle",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: GradleOptions) {
    for (const file of await scanFiles(codebase, "**/build.gradle{,.kts}", options.ignore)) {
      if (hasGradleWrapper(dirname(file))) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string, options: GradleOptions): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];
    const issues: AnalyzerResult["issues"] = [];

    try {
      // Determine the correct gradlew command for the platform
      const isWindows = process.platform === "win32";
      const gradleWrapper = isWindows ? join(dir, "gradlew.bat") : join(dir, "gradlew");
      if (!existsSync(gradleWrapper)) {
        issues.push({
          code: "gradle.wrapper_not_found",
          message: "Gradle wrapper (gradlew) not found",
          severity: "ERROR",
          file,
        });

        return {
          packages: [],
          subprojects: [],
          relationships: [],
          issues,
        };
      }

      const projectInfoScriptPath = join(moduleDir, "project-info.gradle");
      const projectInfoCommand = [gradleWrapper, "-I", projectInfoScriptPath, "-q"];

      const env = { ...process.env };
      if (options.javaHome) {
        env.JAVA_HOME = options.javaHome;
      }

      const { stdout: projectInfoOutput, exitCode: projectInfoExitCode } = await runCommand(
        projectInfoCommand,
        {
          cwd: dir,
          stderr: "inherit",
          env,
        },
      );

      // Parse project info (with fallback if it fails)
      interface ProjectInfo {
        name: string;
        group: string;
        version: string;
        buildFile?: string;
      }

      const projectInfoMap = new Map<string, ProjectInfo>();
      if (projectInfoExitCode === 0) {
        try {
          const startMarker = "===PROJECT_INFO_START===";
          const endMarker = "===PROJECT_INFO_END===";

          // Find all project info blocks (there can be multiple for multi-build projects like buildSrc)
          let searchPos = 0;
          while (true) {
            const startIndex = projectInfoOutput.indexOf(startMarker, searchPos);
            if (startIndex === -1) break;

            const endIndex = projectInfoOutput.indexOf(endMarker, startIndex);
            if (endIndex === -1) break;

            const jsonStr = projectInfoOutput
              .substring(startIndex + startMarker.length, endIndex)
              .trim();
            const projectInfoData = JSON.parse(jsonStr) as Record<string, ProjectInfo>;

            const entries = Object.entries(projectInfoData);
            const rootInfo = projectInfoData[":"];
            if (entries.length === 1 && rootInfo?.name === "buildSrc") {
              projectInfoMap.set(":buildSrc", rootInfo);
            } else {
              for (const [path, info] of entries) {
                projectInfoMap.set(path, info);
              }
            }

            searchPos = endIndex + endMarker.length;
          }
        } catch (error) {
          issues.push({
            code: "gradle.project_info_parse_failed",
            message: `Failed to parse project info: ${error instanceof Error ? error.message : String(error)}`,
            severity: "WARNING",
            file,
          });
        }
      } else {
        issues.push({
          code: "gradle.project_metadata_extraction_failed",
          message: "Failed to extract project metadata, using fallback values",
          severity: "WARNING",
          file,
        });
      }

      const gradleCommand = [
        gradleWrapper,
        "-I",
        join(moduleDir, "init.gradle"),
        "--dependency-verification=off",
        "--no-configuration-cache",
        "--no-configure-on-demand",
        ":ForceDependencyResolutionPlugin_resolveAllDependencies",
      ];

      const { exitCode } = await runCommand(gradleCommand, {
        cwd: dir,
        stdout: "inherit",
        stderr: "inherit",
        env,
      });
      if (exitCode !== 0) {
        issues.push({
          code: "gradle.dependency_extraction_failed",
          message: `Gradle dependency extraction failed with exit code ${exitCode}`,
          severity: "ERROR",
          file,
        });

        return {
          packages: [],
          subprojects: [],
          relationships: [],
          issues,
        };
      }

      // Read the generated dependency graph file
      const reportsDir = join(dir, "build", "reports", "dependency-graph-snapshots");
      const graphFile = join(reportsDir, "dependency-graph.json");

      if (!existsSync(graphFile)) {
        issues.push({
          code: "gradle.dependency_graph_not_found",
          message: "dependency-graph.json not found",
          severity: "ERROR",
          file,
        });

        return {
          packages: [],
          subprojects: [],
          relationships: [],
          issues,
        };
      }

      // Parse the dependency graph
      const graphContent = await readTextFile(graphFile);
      const dependencyGraph: DependencyGraphOutput = JSON.parse(graphContent);

      // Note: We no longer use the dependency-resolution.json file
      // as we keep the original Gradle configuration names as scopes

      // Process each configuration graph
      const projectMap = new Map<
        string,
        {
          name: string;
          group: string;
          version: string;
          definitionFile: string;
          scopes: Map<string, Set<string>>;
          directDeps: Set<string>;
        }
      >();

      for (const config of dependencyGraph) {
        const projectPath = config.rootOrigin.path;

        // Skip empty configurations
        if (config.allDependencies.length === 0) {
          continue;
        }

        if (!projectMap.has(projectPath)) {
          const info = projectInfoMap.get(projectPath);
          if (info) {
            projectMap.set(projectPath, {
              name: info.name,
              group: info.group,
              version: info.version,
              definitionFile: info.buildFile ?? file,
              scopes: new Map(),
              directDeps: new Set(),
            });
          } else {
            const originId = config.rootOrigin.id;
            const projectName =
              originId.replace(/^(project|build)\s+/, "").replace(":", "") || "root";

            projectMap.set(projectPath, {
              name: projectName,
              group: "",
              version: "",
              definitionFile: file,
              scopes: new Map(),
              directDeps: new Set(),
            });

            if (!issues.some((i) => i.message.includes("using fallback values for project"))) {
              issues.push({
                code: "gradle.project_metadata_unknown",
                message: `Could not determine project metadata for '${projectPath}', using fallback values`,
                severity: "HINT",
                file,
              });
            }
          }
        }

        const project = projectMap.get(projectPath)!;

        // Use the original Gradle configuration name as the scope
        const configScope = config.configurationName;

        // Ensure scope exists
        if (!project.scopes.has(configScope)) {
          project.scopes.set(configScope, new Set());
        }

        // Process all dependencies in this configuration
        for (const dep of config.allDependencies) {
          if (shouldSkipDependency(dep)) {
            continue;
          }

          // Normalize version: omit "unspecified" for internal projects
          const version =
            dep.isProject && dep.coordinates.version === "unspecified"
              ? ""
              : dep.coordinates.version;

          const depPurl = dep.isProject
            ? createGradleProjectPurl(dep.coordinates.group, dep.coordinates.module, version)
            : createMavenPurl(
                dep.coordinates.group,
                dep.coordinates.module,
                version,
                dep.repositoryUrl,
              );

          // Only add external packages to package map (not internal projects)
          if (!dep.isProject) {
            ensurePackageExists(packageMap, depPurl);
            addPackageEvidence(packageMap, depPurl, project.definitionFile);
          }

          // Add all direct dependencies to scopes (both projects and external packages)
          if (dep.isDirect) {
            const effectiveScope = configScope;
            if (!project.scopes.has(effectiveScope)) {
              project.scopes.set(effectiveScope, new Set());
            }

            project.scopes.get(effectiveScope)!.add(depPurl);
            project.directDeps.add(depPurl);
          }

          // Add relationships between external dependencies only (not from/to projects)
          if (!dep.isProject && dep.dependencies && dep.dependencies.length > 0) {
            for (const transitiveDep of dep.dependencies) {
              const transitiveNode = config.allDependencies.find((d) => d.id === transitiveDep);
              if (
                transitiveNode &&
                !transitiveNode.isProject &&
                !shouldSkipDependency(transitiveNode)
              ) {
                const transitivePurl = createMavenPurl(
                  transitiveNode.coordinates.group,
                  transitiveNode.coordinates.module,
                  transitiveNode.coordinates.version,
                  transitiveNode.repositoryUrl,
                );
                addRelationship(relationshipsMap, depPurl, transitivePurl);
              }
            }
          }
        }
      }

      // Convert project map to subprojects
      for (const [projectPath, project] of projectMap.entries()) {
        const scopes: DependencyScope[] = [];

        for (const [scopeName, packages] of project.scopes.entries()) {
          if (packages.size > 0) {
            scopes.push({
              scope: scopeName,
              packages: Array.from(packages),
            });
          }
        }

        if (scopes.length > 0) {
          // Create a PURL for the project
          // Omit version if it's "unspecified" (Gradle's default when not set in build.gradle)
          const projectVersion = project.version === "unspecified" ? "" : project.version;
          const projectPurl = createGradleProjectPurl(project.group, project.name, projectVersion);

          if (!project.group) {
            issues.push({
              code: "gradle.project_group_missing",
              message: `Gradle project '${projectPath}' does not declare a group, using a generic PURL instead of a Maven PURL`,
              severity: "WARNING",
              file: project.definitionFile,
            });
          }

          subprojects.push({
            purl: projectPurl,
            definitionFile: project.definitionFile,
            scopes,
          });
        }
      }
    } catch (error) {
      issues.push({
        code: "gradle.extraction_failed",
        message: `Failed to extract dependencies: ${error instanceof Error ? error.message : String(error)}`,
        severity: "ERROR",
        file,
      });
    }

    return {
      ...buildResult(packageMap, relationshipsMap, subprojects),
      issues,
    };
  },
});

const MAVEN_CENTRAL_URLS = [
  "https://repo.maven.apache.org/maven2",
  "https://repo1.maven.org/maven2",
] as const;

function hasGradleWrapper(dir: string): boolean {
  return process.platform === "win32"
    ? existsSync(join(dir, "gradlew.bat"))
    : existsSync(join(dir, "gradlew"));
}

function shouldSkipDependency(dep: DependencyNode): boolean {
  return isInjectedDependencyGraphPlugin(dep);
}

function isInjectedDependencyGraphPlugin(dep: DependencyNode): boolean {
  return (
    dep.coordinates.group === "org.gradle" &&
    dep.coordinates.module === "github-dependency-graph-gradle-plugin" &&
    dep.coordinates.version === "1.4.0" &&
    dep.repositoryUrl === "https://plugins.gradle.org/m2"
  );
}

function createGradleProjectPurl(group: string, name: string, version: string): string {
  if (group) {
    return createMavenPurl(group, name, version);
  }

  return new PackageURL("generic", null, name, version, null, null).toString();
}

function createMavenPurl(group: string, name: string, version: string, repoUrl?: string): string {
  const namespace = group || null;

  const isMavenCentral =
    MAVEN_CENTRAL_URLS.includes(repoUrl as (typeof MAVEN_CENTRAL_URLS)[number]) ||
    repoUrl?.startsWith("file:"); // Local Maven cache (file: URLs are machine-specific)

  const qualifiers = !isMavenCentral && repoUrl ? { repository_url: repoUrl } : null;

  return new PackageURL("maven", namespace, name, version, qualifiers, null).toString();
}
