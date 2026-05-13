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
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path/posix';
import { existsSync } from 'node:fs';
import type { MavenOptions } from './options.ts';
import { optionSchema } from './options.ts';

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
  const issues: AnalyzerResult['issues'] = [];

  try {
    const mavenCmd = options.mavenPath;

    const isWindows = process.platform === 'win32';
    const mvnWrapper = isWindows ? join(dir, 'mvnw.cmd') : join(dir, 'mvnw');
    // we need to use "Bun.which" here, as this is required to find the executable
    // in case of the mise environment combined with explcitly stating the env for Bun.spawn
    const mvnExecutable = existsSync(mvnWrapper) ? mvnWrapper : Bun.which(mavenCmd) || mavenCmd;

    const env = { ...process.env };
    if (options.javaHome) {
      env.JAVA_HOME = options.javaHome;
    }

    // Extract project metadata
    const groupIdProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.groupId', '-q', '-DforceStdout'],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe', env },
    );
    const groupId = (await new Response(groupIdProc.stdout).text()).trim();
    const groupIdExitCode = await groupIdProc.exited;

    const artifactIdProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.artifactId', '-q', '-DforceStdout'],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe', env },
    );
    const artifactId = (await new Response(artifactIdProc.stdout).text()).trim();
    const artifactIdExitCode = await artifactIdProc.exited;

    const versionProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.version', '-q', '-DforceStdout'],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe', env },
    );
    const version = (await new Response(versionProc.stdout).text()).trim();
    const versionExitCode = await versionProc.exited;

    if (groupIdExitCode !== 0 || artifactIdExitCode !== 0 || versionExitCode !== 0) {
      issues.push({ message: 'Failed to extract project metadata', severity: 'ERROR', file });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    // Extract dependency tree
    const depTreeFile = join(dir, '.dependency-tree.json');
    const depTreeProc = Bun.spawn(
      [mvnExecutable, 'dependency:tree', '-DoutputType=json', `-DoutputFile=${depTreeFile}`, '--batch-mode'],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe', env },
    );
    const depTreeExitCode = await depTreeProc.exited;

    if (depTreeExitCode !== 0) {
      const stderr = await new Response(depTreeProc.stderr).text();
      issues.push({ message: `Maven dependency extraction failed: ${stderr}`, severity: 'ERROR', file });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    if (!existsSync(depTreeFile)) {
      issues.push({ message: 'Dependency tree file not found', severity: 'ERROR', file });
      return { packages: [], subprojects: [], relationships: [], issues };
    }

    const depTreeContent = await Bun.file(depTreeFile).text();
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
        const scope = node.scope || 'compile';
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
      await Bun.file(depTreeFile).delete();
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    issues.push({
      message: `Failed to extract dependencies: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'ERROR',
      file,
    });
  }

  return {
    ...buildResult(packageMap, relationshipsMap, subprojects),
    issues,
  };
}

export const extractor: Extractor<MavenOptions> = {
  name: 'maven',
  version: 1,
  optionsSchema: optionSchema,
  extract: async (codebase: string, runtimeOptions?: Partial<MavenOptions>) => {
    const options = optionSchema.parse(runtimeOptions || {});
    const ignorePatterns = options.ignore;
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const files: string[] = [];
    const glob = new Glob('**/pom.xml');
    for await (let file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      file = file.replaceAll('\\', '/');
      if (!ignoreGlobs.some((g) => g.match(file))) {
        files.push(file);
      }
    }

    const results: AnalyzerResult[] = [];
    for (const file of files) {
      results.push(await extractFile(file, options));
    }

    const merged = mergeResults(results);

    // Filter subproject purls from packages and relationships (cross-file)
    const subprojectPurls = new Set(merged.subprojects.map((sp) => sp.purl));
    const normalizedCodebase = codebase.endsWith('/') ? codebase.slice(0, -1) : codebase;
    const makeRelative = (path: string) =>
      path.startsWith(normalizedCodebase + '/') ? path.substring(normalizedCodebase.length + 1) : path;

    return {
      packages: merged.packages
        .filter((pkg) => !subprojectPurls.has(pkg.purl))
        .map((pkg) => ({ ...pkg, evidence: pkg.evidence.map(makeRelative) })),
      subprojects: merged.subprojects.map((sp) => ({ ...sp, definitionFile: makeRelative(sp.definitionFile) })),
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
  return new PackageURL('maven', namespace, artifactId, version, null, null).toString();
}
