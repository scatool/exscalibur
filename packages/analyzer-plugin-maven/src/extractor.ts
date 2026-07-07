import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  mergeResults,
  type Subproject,
  addRelationship,
  ensurePackageExists,
  addPackageEvidence,
  buildResult,
  initializeExtractionMaps,
  findExecutable,
  readTextFile,
  runCommand,
  scanFiles,
  type ExtractionRuntimeOptions,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";
import { dirname, join } from "node:path/posix";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { MavenOptions } from "./options.ts";
import { optionSchema } from "./options.ts";

interface DependencyNode {
  groupId: string;
  artifactId: string;
  version: string;
  type: string;
  scope: string;
  classifier: string;
  optional: string;
  children?: DependencyNode[];
}

async function extractFile(file: string, options: MavenOptions): Promise<AnalyzerResult> {
  const dir = dirname(file);
  const { packageMap, relationshipsMap } = initializeExtractionMaps();
  const subprojects: Subproject[] = [];
  const issues: AnalyzerResult["issues"] = [];

  try {
    const mavenCmd = options.mavenPath;

    const isWindows = process.platform === "win32";
    const mvnWrapper = isWindows ? join(dir, "mvnw.cmd") : join(dir, "mvnw");
    const mvnExecutable = existsSync(mvnWrapper)
      ? mvnWrapper
      : findExecutable(mavenCmd) || mavenCmd;

    const env = { ...process.env };
    if (options.javaHome) {
      env.JAVA_HOME = options.javaHome;
    }

    // Extract project metadata
    const groupIdProc = await runCommand(
      [mvnExecutable, "help:evaluate", "-Dexpression=project.groupId", "-q", "-DforceStdout"],
      {
        cwd: dir,
        env,
      },
    );
    const groupId = groupIdProc.stdout.trim();
    const groupIdExitCode = groupIdProc.exitCode;

    const artifactIdProc = await runCommand(
      [mvnExecutable, "help:evaluate", "-Dexpression=project.artifactId", "-q", "-DforceStdout"],
      { cwd: dir, env },
    );
    const artifactId = artifactIdProc.stdout.trim();
    const artifactIdExitCode = artifactIdProc.exitCode;

    const versionProc = await runCommand(
      [mvnExecutable, "help:evaluate", "-Dexpression=project.version", "-q", "-DforceStdout"],
      {
        cwd: dir,
        env,
      },
    );
    const version = versionProc.stdout.trim();
    const versionExitCode = versionProc.exitCode;

    if (groupIdExitCode !== 0 || artifactIdExitCode !== 0 || versionExitCode !== 0) {
      issues.push({
        code: "maven.project_metadata_extraction_failed",
        message: "Failed to extract project metadata",
        severity: "ERROR",
        file,
      });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    // Extract dependency tree
    const depTreeFile = join(dir, ".dependency-tree.json");
    const depTreeProc = await runCommand(
      [
        mvnExecutable,
        "dependency:tree",
        "-DoutputType=json",
        `-DoutputFile=${depTreeFile}`,
        "--batch-mode",
      ],
      { cwd: dir, env },
    );
    const depTreeExitCode = depTreeProc.exitCode;

    if (depTreeExitCode !== 0) {
      issues.push({
        code: "maven.dependency_extraction_failed",
        message: `Maven dependency extraction failed: ${depTreeProc.stderr}`,
        severity: "ERROR",
        file,
      });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    if (!existsSync(depTreeFile)) {
      issues.push({
        code: "maven.dependency_tree_not_found",
        message: "Dependency tree file not found",
        severity: "ERROR",
        file,
      });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    const depTreeContent = await readTextFile(depTreeFile);
    const depTree: DependencyNode = JSON.parse(depTreeContent);

    const scopeMap = new Map<string, Set<string>>();

    const processNode = (node: DependencyNode, isRoot: boolean, isDirect: boolean) => {
      if (isRoot) {
        if (node.children) {
          for (const child of node.children) {
            processNode(child, false, true);
          }
        }
        return;
      }

      const purl = createMavenPurl(node.groupId, node.artifactId, node.version);

      ensurePackageExists(packageMap, purl);
      addPackageEvidence(packageMap, purl, file);

      if (isDirect) {
        const scope = node.scope || "compile";
        if (!scopeMap.has(scope)) {
          scopeMap.set(scope, new Set());
        }
        scopeMap.get(scope)!.add(purl);
      }

      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          const childPurl = createMavenPurl(child.groupId, child.artifactId, child.version);
          addRelationship(relationshipsMap, purl, childPurl);
          processNode(child, false, false);
        }
      }
    };

    processNode(depTree, true, false);

    const scopes: DependencyScope[] = [];
    for (const [scopeName, packages] of scopeMap.entries()) {
      if (packages.size > 0) {
        scopes.push({ scope: scopeName, packages: Array.from(packages) });
      }
    }

    if (scopes.length > 0 || packageMap.size > 0) {
      const projectPurl = createMavenPurl(groupId, artifactId, version);
      subprojects.push({ purl: projectPurl, definitionFile: file, scopes });
    }

    try {
      await rm(depTreeFile);
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    issues.push({
      code: "maven.extraction_failed",
      message: `Failed to extract dependencies: ${error instanceof Error ? error.message : String(error)}`,
      severity: "ERROR",
      file,
    });
  }

  return {
    ...buildResult(packageMap, relationshipsMap, subprojects),
    issues,
  };
}

export const extractor: Extractor<MavenOptions> = {
  name: "maven",
  version: 1,
  optionsSchema: optionSchema,
  extract: async (
    codebase: string,
    runtimeOptions?: Partial<MavenOptions>,
    extractionRuntimeOptions: ExtractionRuntimeOptions = {},
  ) => {
    const options = optionSchema.parse(runtimeOptions || {});
    const files = await scanFiles(codebase, "**/pom.xml", [
      ...(extractionRuntimeOptions.ignore ?? []),
      ...options.ignore,
    ]);

    const results: AnalyzerResult[] = [];
    for (const file of files) {
      results.push(await extractFile(file, options));
    }

    const merged = mergeResults(results);

    // Filter subproject purls from packages and relationships (cross-file)
    const subprojectPurls = new Set(merged.subprojects.map((sp) => sp.purl));
    const normalizedCodebase = codebase.endsWith("/") ? codebase.slice(0, -1) : codebase;
    const makeRelative = (path: string) =>
      path.startsWith(normalizedCodebase + "/")
        ? path.substring(normalizedCodebase.length + 1)
        : path;

    return {
      packages: merged.packages
        .filter((pkg) => !subprojectPurls.has(pkg.purl))
        .map((pkg) => ({ ...pkg, evidence: pkg.evidence.map(makeRelative) })),
      subprojects: merged.subprojects.map((sp) => ({
        ...sp,
        definitionFile: makeRelative(sp.definitionFile),
      })),
      relationships: merged.relationships
        .filter((rel) => !subprojectPurls.has(rel.from))
        .map((rel) => ({ ...rel, to: rel.to.filter((to) => !subprojectPurls.has(to)) }))
        .filter((rel) => rel.to.length > 0),
      issues: merged.issues.map((issue) => ({
        ...issue,
        ...(issue.file && { file: makeRelative(issue.file) }),
      })),
    };
  },
};

function createMavenPurl(groupId: string, artifactId: string, version: string): string {
  const namespace = groupId || null;
  return new PackageURL("maven", namespace, artifactId, version, null, null).toString();
}
