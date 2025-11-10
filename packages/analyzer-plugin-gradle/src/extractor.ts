import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Relationship,
  type Subproject,
  type Package,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const buildFileGlob = new Glob('**/build.gradle{,.kts}');

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

export const extractor: Extractor = filesExtractor({
  name: 'gradle',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of buildFileGlob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/build/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
    const relationshipsMap = new Map<string, Set<string>>();
    const subprojects: Subproject[] = [];
    const issues: AnalyzerResult['issues'] = [];

    try {
      // Check if gradlew exists
      const gradlewPath = join(dir, 'gradlew');
      const gradlewBatPath = join(dir, 'gradlew.bat');
      const hasGradlew = existsSync(gradlewPath) || existsSync(gradlewBatPath);

      if (!hasGradlew) {
        // Skip if no gradle wrapper is available
        return {
          packages: [],
          subprojects: [],
          relationships: [],
          issues: [],
        };
      }

      // Determine the correct gradlew command for the platform
      const isWindows = process.platform === 'win32';
      const gradleWrapper = isWindows ? gradlewBatPath : gradlewPath;

      if (!existsSync(gradleWrapper)) {
        return {
          packages: [],
          subprojects: [],
          relationships: [],
          issues: [],
        };
      }

      // First, get project metadata (group, name, version) for all projects
      const projectInfoScriptPath = join(import.meta.dir, 'project-info.gradle');
      const projectInfoCommand = [gradleWrapper, '-I', projectInfoScriptPath, '-q'];

      const projectInfoProc = Bun.spawn(projectInfoCommand, {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });

      const projectInfoOutput = await new Response(projectInfoProc.stdout).text();
      const projectInfoExitCode = await projectInfoProc.exited;

      // Parse project info (with fallback if it fails)
      interface ProjectInfo {
        name: string;
        group: string;
        version: string;
      }
      const projectInfoMap = new Map<string, ProjectInfo>();

      if (projectInfoExitCode === 0) {
        try {
          const startMarker = '===PROJECT_INFO_START===';
          const endMarker = '===PROJECT_INFO_END===';

          // Find all project info blocks (there can be multiple for multi-build projects like buildSrc)
          let searchPos = 0;
          while (true) {
            const startIndex = projectInfoOutput.indexOf(startMarker, searchPos);
            if (startIndex === -1) break;

            const endIndex = projectInfoOutput.indexOf(endMarker, startIndex);
            if (endIndex === -1) break;

            const jsonStr = projectInfoOutput.substring(startIndex + startMarker.length, endIndex).trim();
            const projectInfoData = JSON.parse(jsonStr) as Record<string, ProjectInfo>;

            for (const [path, info] of Object.entries(projectInfoData)) {
              projectInfoMap.set(path, info);
            }

            searchPos = endIndex + endMarker.length;
          }
        } catch (error) {
          issues.push({
            message: `Failed to parse project info: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'WARNING',
            file,
          });
        }
      } else {
        issues.push({
          message: 'Failed to extract project metadata, using fallback values',
          severity: 'HINT',
          file,
        });
      }

      // Get the path to our init script
      const initScriptPath = join(import.meta.dir, 'init.gradle');

      // Run gradle with the dependency graph plugin
      const gradleCommand = [
        gradleWrapper,
        '-I',
        initScriptPath,
        '--dependency-verification=off',
        '--no-configuration-cache',
        '--no-configure-on-demand',
        ':ForceDependencyResolutionPlugin_resolveAllDependencies',
      ];

      const proc = Bun.spawn(gradleCommand, {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // Gradle command failed - try to extract useful error info
        let errorMessage = `Gradle dependency extraction failed with exit code ${exitCode}`;

        // Look for common error patterns in stderr
        if (stderr.includes('JVM runtime version')) {
          const jvmMatch = stderr.match(/requires at least JVM runtime version (\d+)/);
          if (jvmMatch) {
            errorMessage += ` (requires Java ${jvmMatch[1]}+)`;
          }
        } else if (stderr.includes('requires Java')) {
          const javaMatch = stderr.match(/requires Java (\d+)/);
          if (javaMatch) {
            errorMessage += ` (requires Java ${javaMatch[1]}+)`;
          }
        } else if (stderr.includes('Could not find') || stderr.includes('Could not resolve')) {
          errorMessage += ' (dependency resolution failed)';
        } else if (stderr.includes('Connection refused') || stderr.includes('UnknownHostException')) {
          errorMessage += ' (network error)';
        }

        issues.push({
          message: errorMessage,
          severity: 'WARNING',
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
      const reportsDir = join(dir, 'build', 'reports', 'dependency-graph-snapshots');
      const graphFile = join(reportsDir, 'dependency-graph.json');

      if (!existsSync(graphFile)) {
        issues.push({
          message: 'Dependency graph file not found after Gradle execution',
          severity: 'WARNING',
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
      const graphContent = await Bun.file(graphFile).text();
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

        // Get or create project entry
        if (!projectMap.has(projectPath)) {
          // Try to get project info from the metadata we fetched
          const info = projectInfoMap.get(projectPath);

          if (info) {
            // Use actual project metadata
            projectMap.set(projectPath, {
              name: info.name,
              group: info.group,
              version: info.version,
              scopes: new Map(),
              directDeps: new Set(),
            });
          } else {
            // Fallback: extract name from rootOrigin and use placeholders
            const originId = config.rootOrigin.id;
            const projectName = originId.replace(/^(project|build)\s+/, '').replace(':', '') || 'root';

            projectMap.set(projectPath, {
              name: projectName,
              group: 'unknown',
              version: 'unknown',
              scopes: new Map(),
              directDeps: new Set(),
            });

            // Add an issue for this fallback
            if (!issues.some((i) => i.message.includes('using fallback values for project'))) {
              issues.push({
                message: `Could not determine project metadata for '${projectPath}', using fallback values`,
                severity: 'HINT',
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
          // Skip project dependencies (internal workspace dependencies)
          if (dep.isProject) {
            continue;
          }

          const depPurl = createMavenPurl(
            dep.coordinates.group,
            dep.coordinates.module,
            dep.coordinates.version,
            dep.repositoryUrl,
          );

          // Add to package map with evidence
          if (!packageMap.has(depPurl)) {
            packageMap.set(depPurl, { purl: depPurl, evidence: new Set([file]) });
          } else {
            packageMap.get(depPurl)!.evidence.add(file);
          }

          // Use the configuration scope directly
          const effectiveScope = configScope;

          if (!project.scopes.has(effectiveScope)) {
            project.scopes.set(effectiveScope, new Set());
          }
          project.scopes.get(effectiveScope)!.add(depPurl);

          // Track direct dependencies
          if (dep.isDirect) {
            project.directDeps.add(depPurl);
          }

          // Add relationships between dependencies
          if (dep.dependencies && dep.dependencies.length > 0) {
            if (!relationshipsMap.has(depPurl)) {
              relationshipsMap.set(depPurl, new Set());
            }

            for (const transitiveDep of dep.dependencies) {
              // Find the corresponding dependency node to get its coordinates
              const transitiveNode = config.allDependencies.find((d) => d.id === transitiveDep);
              if (transitiveNode && !transitiveNode.isProject) {
                const transitivePurl = createMavenPurl(
                  transitiveNode.coordinates.group,
                  transitiveNode.coordinates.module,
                  transitiveNode.coordinates.version,
                  transitiveNode.repositoryUrl,
                );
                relationshipsMap.get(depPurl)!.add(transitivePurl);
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
          const projectPurl = createMavenPurl(project.group, project.name, project.version);

          subprojects.push({
            purl: projectPurl,
            definitionFile: file,
            scopes,
          });

          // Add relationship from project to its direct dependencies
          if (project.directDeps.size > 0) {
            relationshipsMap.set(projectPurl, project.directDeps);
          }
        }
      }
    } catch (error) {
      issues.push({
        message: `Failed to extract dependencies: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'ERROR',
        file,
      });
    }

    // Convert maps to arrays
    const packages: Package[] = Array.from(packageMap.values()).map(({ purl, evidence }) => ({
      purl,
      evidence: Array.from(evidence),
    }));

    const relationships: Relationship[] = Array.from(relationshipsMap.entries()).map(([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    }));

    return {
      packages,
      subprojects,
      relationships,
      issues,
    };
  },
});

// Helper to create Maven PURL (Package URL)
function createMavenPurl(group: string, name: string, version: string, repositoryUrl?: string): string {
  const namespace = group || null;

  // Only add repository_url qualifier if it's not Maven Central
  // Maven Central is the default and should not have a qualifier
  const isMavenCentral =
    repositoryUrl === 'https://repo.maven.apache.org/maven2' || repositoryUrl === 'https://repo1.maven.org/maven2';

  const qualifiers = !isMavenCentral && repositoryUrl ? { repository_url: repositoryUrl } : null;

  return new PackageURL('maven', namespace, name, version, qualifiers, null).toString();
}
