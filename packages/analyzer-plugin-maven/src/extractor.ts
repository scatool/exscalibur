import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  mergeResults,
  type Package,
  type Relationship,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export interface MavenOptions {
  /**
   * Array of glob patterns to ignore when scanning for pom files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/target\/**', '**\/.mvn\/**']
   */
  ignore?: string[];

  /**
   * Path to the Java home directory.
   * If not specified, the JAVA_HOME environment variable will be used.
   */
  javaHome?: string;

  /**
   * Path to the Maven executable.
   * If not specified, 'mvn' will be used from PATH.
   */
  mavenPath?: string;
}

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
  const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
  const relationshipsMap = new Map<string, Set<string>>();
  const subprojects: Subproject[] = [];
  const issues: AnalyzerResult['issues'] = [];

  try {
    const mavenCmd = options.mavenPath ?? 'mvn';

    // Check if Maven wrapper exists
    const isWindows = process.platform === 'win32';
    const mvnWrapper = isWindows ? join(dir, 'mvnw.cmd') : join(dir, 'mvnw');
    const hasMvnWrapper = existsSync(mvnWrapper);
    const mvnExecutable = hasMvnWrapper ? mvnWrapper : mavenCmd;

    const env = { ...process.env };
    if (options.javaHome) {
      env.JAVA_HOME = options.javaHome;
    }

    // Extract project metadata
    const groupIdProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.groupId', '-q', '-DforceStdout'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      },
    );

    const groupId = (await new Response(groupIdProc.stdout).text()).trim();
    const groupIdExitCode = await groupIdProc.exited;

    const artifactIdProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.artifactId', '-q', '-DforceStdout'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      },
    );

    const artifactId = (await new Response(artifactIdProc.stdout).text()).trim();
    const artifactIdExitCode = await artifactIdProc.exited;

    const versionProc = Bun.spawn(
      [mvnExecutable, 'help:evaluate', '-Dexpression=project.version', '-q', '-DforceStdout'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      },
    );

    const version = (await new Response(versionProc.stdout).text()).trim();
    const versionExitCode = await versionProc.exited;

    if (groupIdExitCode !== 0 || artifactIdExitCode !== 0 || versionExitCode !== 0) {
      issues.push({
        message: 'Failed to extract project metadata',
        severity: 'ERROR',
        file,
      });

      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues,
      };
    }

    // Extract dependency tree
    const depTreeFile = join(dir, '.dependency-tree.json');
    const depTreeProc = Bun.spawn(
      [mvnExecutable, 'dependency:tree', '-DoutputType=json', `-DoutputFile=${depTreeFile}`, '--batch-mode'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      },
    );

    const depTreeExitCode = await depTreeProc.exited;

    if (depTreeExitCode !== 0) {
      const stderr = await new Response(depTreeProc.stderr).text();
      issues.push({
        message: `Maven dependency extraction failed: ${stderr}`,
        severity: 'ERROR',
        file,
      });

      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues,
      };
    }

    // Read and parse the dependency tree
    if (!existsSync(depTreeFile)) {
      issues.push({
        message: 'Dependency tree file not found',
        severity: 'ERROR',
        file,
      });

      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues,
      };
    }

    const depTreeContent = await Bun.file(depTreeFile).text();
    const depTree: DependencyNode = JSON.parse(depTreeContent);

    // Track direct dependencies by scope
    const scopeMap = new Map<string, Set<string>>();

    // Process dependency tree recursively
    const processNode = (node: DependencyNode, isRoot: boolean, isDirect: boolean) => {
      // Skip the root node (the project itself)
      if (isRoot) {
        if (node.children) {
          for (const child of node.children) {
            processNode(child, false, true);
          }
        }
        return;
      }

      const purl = createMavenPurl(node.groupId, node.artifactId, node.version);

      // Add to package map
      if (!packageMap.has(purl)) {
        packageMap.set(purl, { purl, evidence: new Set([file]) });
      } else {
        packageMap.get(purl)!.evidence.add(file);
      }

      // Track direct dependencies by scope
      if (isDirect) {
        const scope = node.scope || 'compile';
        if (!scopeMap.has(scope)) {
          scopeMap.set(scope, new Set());
        }
        scopeMap.get(scope)!.add(purl);
      }

      // Process transitive dependencies and create relationships
      if (node.children && node.children.length > 0) {
        if (!relationshipsMap.has(purl)) {
          relationshipsMap.set(purl, new Set());
        }

        for (const child of node.children) {
          const childPurl = createMavenPurl(child.groupId, child.artifactId, child.version);
          relationshipsMap.get(purl)!.add(childPurl);
          processNode(child, false, false);
        }
      }
    };

    processNode(depTree, true, false);

    // Create subproject
    const scopes: DependencyScope[] = [];
    for (const [scopeName, packages] of scopeMap.entries()) {
      if (packages.size > 0) {
        scopes.push({
          scope: scopeName,
          packages: Array.from(packages),
        });
      }
    }

    if (scopes.length > 0 || packageMap.size > 0) {
      const projectPurl = createMavenPurl(groupId, artifactId, version);
      subprojects.push({
        purl: projectPurl,
        definitionFile: file,
        scopes,
      });
    }

    // Clean up temporary file
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

  // Convert maps to arrays and filter out subproject purls
  const subprojectPurls = new Set(subprojects.map((sp) => sp.purl));

  const packages: Package[] = Array.from(packageMap.values())
    .filter(({ purl }) => !subprojectPurls.has(purl))
    .map(({ purl, evidence }) => ({
      purl,
      evidence: Array.from(evidence),
    }));

  const relationships: Relationship[] = Array.from(relationshipsMap.entries())
    .filter(([from]) => !subprojectPurls.has(from))
    .map(([from, toSet]) => ({
      from,
      to: Array.from(toSet).filter((to) => !subprojectPurls.has(to)),
    }))
    .filter((rel) => rel.to.length > 0);

  return {
    packages,
    subprojects,
    relationships,
    issues,
  };
}

export const extractor: Extractor<MavenOptions> = {
  name: 'maven',
  version: 1,
  options: async () => ({
    ignore: ['**/target/**', '**/.mvn/**'],
  }),
  extract: async (codebase: string, runtimeOptions?: Partial<MavenOptions>) => {
    const defaultOptions = await extractor.options!();
    const options = { ...defaultOptions, ...runtimeOptions } as MavenOptions;

    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    // Find all pom.xml files
    const files: string[] = [];
    const glob = new Glob('**/pom.xml');
    for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        files.push(file);
      }
    }

    // Extract from each file
    const results: AnalyzerResult[] = [];
    for (const file of files) {
      const result = await extractFile(file, options);
      results.push(result);
    }

    // Merge results and filter out subproject purls
    const mergedResult = mergeResults(results);
    const subprojectPurls = new Set(mergedResult.subprojects.map((sp) => sp.purl));

    const filteredPackages = mergedResult.packages.filter((pkg) => !subprojectPurls.has(pkg.purl));
    const filteredRelationships = mergedResult.relationships
      .filter((rel) => !subprojectPurls.has(rel.from))
      .map((rel) => ({
        ...rel,
        to: rel.to.filter((to) => !subprojectPurls.has(to)),
      }))
      .filter((rel) => rel.to.length > 0);

    // Make paths relative
    const normalizedCodebase = codebase.endsWith('/') ? codebase.slice(0, -1) : codebase;

    for (const pkg of filteredPackages) {
      pkg.evidence = pkg.evidence.map((e) =>
        e.startsWith(normalizedCodebase + '/') ? e.substring(normalizedCodebase.length + 1) : e,
      );
    }

    for (const subproject of mergedResult.subprojects) {
      if (subproject.definitionFile.startsWith(normalizedCodebase + '/')) {
        subproject.definitionFile = subproject.definitionFile.substring(normalizedCodebase.length + 1);
      }
    }

    for (const issue of mergedResult.issues) {
      if (issue.file && issue.file.startsWith(normalizedCodebase + '/')) {
        issue.file = issue.file.substring(normalizedCodebase.length + 1);
      }
    }

    return {
      packages: filteredPackages,
      subprojects: mergedResult.subprojects,
      relationships: filteredRelationships,
      issues: mergedResult.issues,
    };
  },
};

function createMavenPurl(groupId: string, artifactId: string, version: string): string {
  const namespace = groupId || null;
  return new PackageURL('maven', namespace, artifactId, version, null, null).toString();
}
