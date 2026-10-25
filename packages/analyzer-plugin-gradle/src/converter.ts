import {
  createDependencyGraph,
  createEmptyResult,
  normalizeResult,
  type AnalyzerResult,
  type DependencyEdge,
  type DependencyView,
  type JsonObject,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { isDeepStrictEqual } from "node:util";

export type ProjectInfo = { name: string; group: string; version: string; buildFile?: string };
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

function packagePurl(group: string, name: string, version: string, repository?: string): string {
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
export function convertGradleConfigurations(
  configurations: GradleConfiguration[],
  projects: Record<string, ProjectInfo>,
  file: string,
  codebase: string,
): AnalyzerResult {
  const result = createEmptyResult(codebase);
  const catalog = new Map<string, AnalyzerResult["packages"][number]>();
  const projectSubjects = new Map<string, AnalyzerResult["subprojects"][number]>();

  for (const configuration of configurations) {
    const source = {
      extractor: "gradle",
      files: [file],
      key: JSON.stringify([
        configuration.rootOrigin.id,
        configuration.rootOrigin.path,
        configuration.configurationName,
      ]),
    };
    const projectInfo = projects[configuration.rootOrigin.path];
    const project = {
      purl: packagePurl(
        projectInfo?.group ?? "",
        projectInfo?.name ?? configuration.rootOrigin.id,
        projectInfo?.version ?? "",
      ),
      definitionFile: projectInfo?.buildFile ?? `${file}#${configuration.rootOrigin.path}`,
    };
    const projectKey = JSON.stringify(project);
    const previous = projectSubjects.get(projectKey);
    projectSubjects.set(projectKey, {
      ...project,
      ...(!projectInfo?.group && {
        identityObservations: [
          ...(previous?.identityObservations ?? []),
          { source, synthesizedPurl: true },
        ],
      }),
    });
    if (!projectInfo)
      result.issues.push({
        code: "gradle.project_metadata_unknown",
        severity: "WARNING",
        file,
        message: `No project metadata for ${configuration.rootOrigin.path}; using a source-scoped fallback identity`,
      });

    // Deduplicate exact native records only within this configuration.
    const nodes: DependencyView[] = [
      { id: "root", purl: project.purl, project, dependencyCompleteness: "unknown" },
    ];
    const edges: DependencyEdge[] = [];
    const dependenciesByNativeId = new Map<
      string,
      GradleConfiguration["allDependencies"][number]
    >();
    for (const dependency of configuration.allDependencies) {
      const previous = dependenciesByNativeId.get(dependency.id);
      // Native snapshots can repeat the same record (for example providedCompile).
      // Only exact repeated facts are redundant; conflicting views must not be merged.
      if (previous && !isDeepStrictEqual(previous, dependency))
        throw new Error(
          `Conflicting Gradle dependency ID in configuration: ${dependency.id} (${configuration.configurationName})`,
        );
      dependenciesByNativeId.set(dependency.id, dependency);
    }

    const isInjectedGraphPlugin = (node: GradleConfiguration["allDependencies"][number]) =>
      node.coordinates.group === "org.gradle" &&
      node.coordinates.module === "github-dependency-graph-gradle-plugin" &&
      node.coordinates.version === "1.4.0" &&
      node.repositoryUrl === "https://plugins.gradle.org/m2";

    // Emit configuration-local views before committing the graph to the result.
    for (const dependency of dependenciesByNativeId.values()) {
      if (isInjectedGraphPlugin(dependency)) continue;
      const purl = packagePurl(
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
        const targetNode = dependenciesByNativeId.get(target);
        if (targetNode && isInjectedGraphPlugin(targetNode)) continue;
        const edgeSource = {
          from: id,
          relation: "depends-on" as const,
          selection: "selected" as const,
        };
        edges.push(
          targetNode
            ? { ...edgeSource, to: `node:${target}`, status: "resolved" }
            : {
                ...edgeSource,
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
        roots: [{ id: "root", project, node: "root", scope: configuration.configurationName }],
        nodes,
        edges,
        attributes: {
          "gradle:projection": "dependency-graph-snapshot",
          "gradle:variantCoverage": "unknown",
          "gradle:rootOrigin": configuration.rootOrigin,
          "gradle:nativeScope": configuration.scope,
        },
      }),
    );
  }

  result.packages = [...catalog.values()];
  result.subprojects = [...projectSubjects.values()];
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

  return normalizeResult(result);
}
