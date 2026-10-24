import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  mergeIgnorePatterns,
  normalizeResultV2,
  readTextFile,
  runCommand,
  scanFiles,
  type AnalyzerResultV2,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { optionSchema, type GradleOptions } from "./options.ts";

type ProjectInfo = { name: string; group: string; version: string; buildFile?: string };
export type GradleConfiguration = {
  rootOrigin: { id: string; path: string };
  configurationName: string;
  scope: string;
  allDependencies: {
    id: string;
    origin: { id: string; path: string };
    isDirect: boolean;
    isProject: boolean;
    coordinates: { group: string; module: string; version: string };
    repositoryUrl?: string;
    dependencies: string[];
  }[];
};

function coordinates(group: string, name: string, version: string, repository?: string): string {
  const qualifiers =
    repository &&
    !repository.startsWith("file:") &&
    !["https://repo.maven.apache.org/maven2", "https://repo1.maven.org/maven2"].includes(repository)
      ? { repository_url: repository }
      : null;
  return new PackageURL(
    group ? "maven" : "generic",
    group || null,
    name,
    version && version !== "unspecified" ? version : null,
    qualifiers,
    null,
  ).toString();
}

/** Retain configuration-local native IDs; the snapshot does not establish variant-complete adjacency. */
export function convertGradleConfigurationsV2(
  configurations: GradleConfiguration[],
  projects: Record<string, ProjectInfo>,
  file: string,
  codebase: string,
): AnalyzerResultV2 {
  const result = createEmptyResultV2(codebase);
  const catalog = new Map<string, AnalyzerResultV2["packages"][number]>();
  const subjects = new Map<string, AnalyzerResultV2["subprojects"][number]>();
  for (const config of configurations) {
    const source = {
      extractor: "gradle",
      files: [file],
      key: JSON.stringify([config.rootOrigin.id, config.rootOrigin.path, config.configurationName]),
    };
    const info = projects[config.rootOrigin.path];
    const project = {
      purl: coordinates(info?.group ?? "", info?.name ?? config.rootOrigin.id, info?.version ?? ""),
      definitionFile: info?.buildFile ?? `${file}#${config.rootOrigin.path}`,
    };
    const subjectKey = JSON.stringify(project);
    const previous = subjects.get(subjectKey);
    subjects.set(subjectKey, {
      ...project,
      ...(!info?.group && {
        identityObservations: [
          ...(previous?.identityObservations ?? []),
          { source, synthesizedPurl: true },
        ],
      }),
    });
    if (!info)
      result.issues.push({
        code: "gradle.project_metadata_unknown",
        severity: "WARNING",
        file,
        message: `No project metadata for ${config.rootOrigin.path}; using a source-scoped fallback identity`,
      });
    const nodes: DependencyView[] = [
      { id: "root", purl: project.purl, project, dependencyCompleteness: "unknown" },
    ];
    const edges: DependencyEdge[] = [];
    const native = new Map<string, GradleConfiguration["allDependencies"][number]>();
    for (const dependency of config.allDependencies) {
      const previous = native.get(dependency.id);
      // Native snapshots can repeat the same record (for example providedCompile).
      // Only exact repeated facts are redundant; conflicting views must not be merged.
      if (previous && !isDeepStrictEqual(previous, dependency))
        throw new Error(
          `Conflicting Gradle dependency ID in configuration: ${dependency.id} (${config.configurationName})`,
        );
      native.set(dependency.id, dependency);
    }
    const injected = (node: GradleConfiguration["allDependencies"][number]) =>
      node.coordinates.group === "org.gradle" &&
      node.coordinates.module === "github-dependency-graph-gradle-plugin" &&
      node.coordinates.version === "1.4.0" &&
      node.repositoryUrl === "https://plugins.gradle.org/m2";
    for (const dependency of native.values()) {
      if (injected(dependency)) continue;
      const purl = coordinates(
        dependency.coordinates.group,
        dependency.coordinates.module,
        dependency.coordinates.version,
        dependency.repositoryUrl,
      );
      const existing = catalog.get(purl);
      const observation = !dependency.coordinates.group ? [{ source, synthesizedPurl: true }] : [];
      catalog.set(purl, {
        purl,
        evidence: [file],
        ...((observation.length || existing?.identityObservations) && {
          identityObservations: [...(existing?.identityObservations ?? []), ...observation],
        }),
      });
      const { dependencies: _, ...attributes } = dependency;
      const id = `node:${dependency.id}`;
      nodes.push({
        id,
        purl,
        locator: dependency.id,
        dependencyCompleteness: "unknown",
        attributes: { "gradle:node": attributes as unknown as JsonObject },
      });
      if (dependency.isDirect)
        edges.push({
          from: "root",
          to: id,
          status: "resolved",
          relation: "depends-on",
          selection: "selected",
        });
      for (const target of dependency.dependencies ?? []) {
        const targetNode = native.get(target);
        if (targetNode && injected(targetNode)) continue;
        const common = {
          from: id,
          relation: "depends-on" as const,
          selection: "selected" as const,
        };
        edges.push(
          targetNode
            ? { ...common, to: `node:${target}`, status: "resolved" }
            : {
                ...common,
                status: "unresolved",
                requested: { attributes: { "gradle:nativeTarget": target } },
              },
        );
      }
    }
    result.graphs.push(
      createDependencyGraph({
        source,
        interpretation: "resolved",
        rootCompleteness: "unknown",
        roots: [{ id: "root", project, node: "root", scope: config.configurationName }],
        nodes,
        edges,
        attributes: {
          "gradle:projection": "dependency-graph-snapshot",
          "gradle:variantCoverage": "unknown",
          "gradle:rootOrigin": config.rootOrigin,
          "gradle:nativeScope": config.scope,
        },
      }),
    );
  }
  result.packages = [...catalog.values()];
  result.subprojects = [...subjects.values()];
  if (configurations.length === 0)
    result.graphs.push(
      createDependencyGraph({
        source: { extractor: "gradle", files: [file] },
        interpretation: "unknown",
        rootCompleteness: "unknown",
        roots: [],
        nodes: [],
        edges: [],
      }),
    );
  return normalizeResultV2(result);
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const extractor = filesExtractorV2<GradleOptions>({
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
    const dir = dirname(file);
    const wrapper = join(dir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
    const env = { ...process.env, ...(options.javaHome && { JAVA_HOME: options.javaHome }) };
    const metadata = await runCommand(
      [wrapper, "-I", join(moduleDir, "project-info.gradle"), "-q"],
      { cwd: dir, env },
    );
    if (metadata.exitCode !== 0)
      throw new Error(`Gradle project metadata extraction failed: ${metadata.stderr}`);
    const projects: Record<string, ProjectInfo> = {};
    for (const match of metadata.stdout.matchAll(
      /===PROJECT_INFO_START===\s*([\s\S]*?)\s*===PROJECT_INFO_END===/g,
    )) {
      const block = JSON.parse(match[1]!) as Record<string, ProjectInfo>;
      if (Object.keys(block).length === 1 && block[":"]?.name === "buildSrc")
        projects[":buildSrc"] = block[":"];
      else Object.assign(projects, block);
    }
    const output = await runCommand(
      [
        wrapper,
        "-I",
        join(moduleDir, "init.gradle"),
        "--no-configuration-cache",
        "--no-configure-on-demand",
        ":ForceDependencyResolutionPlugin_resolveAllDependencies",
      ],
      { cwd: dir, env },
    );
    if (output.exitCode !== 0)
      throw new Error(`Gradle dependency extraction failed: ${output.stderr}`);
    const configurations = JSON.parse(
      await readTextFile(
        join(dir, "build/reports/dependency-graph-snapshots/dependency-graph.json"),
      ),
    );
    return convertGradleConfigurationsV2(
      configurations,
      projects,
      context.relativeFile,
      context.codebaseId,
    );
  },
});
