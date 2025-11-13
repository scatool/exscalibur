import {
  addRelationship,
  type AnalyzerResult,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  type DependencyScope,
  ensurePackageExists,
  type Extractor,
  filesExtractor,
  initializeExtractionMaps,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname } from 'node:path';
import { createGoPurl } from '../go-utils.ts';

const glob = new Glob('**/go.mod');

type Dependency = {
  path: string;
  version: string;
  indirect: boolean;
};

export const extractor: Extractor = filesExtractor({
  name: 'gomod',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of glob.scan({ cwd: codebase, absolute: true })) {
      // Exclude vendor and common module cache directories
      if (!file.includes('/vendor/') && !file.includes('/.cache/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const lines = content.split('\n');
    const dir = dirname(file);

    // Parse go.mod to get module name and direct/indirect dependency info
    const moduleName = parseModuleName(content);
    if (!moduleName) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: 'ERROR',
            message: 'Failed to parse module name from go.mod',
            file,
          },
        ],
      };
    }

    const directDepsSet = parseDirectDependencies(content);

    // Run `go list -m -json all` to get selected module versions
    const selectedModules = await runGoListModules(dir);
    if (!selectedModules) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: 'ERROR',
            message: 'Failed to run go list -m -json all. Ensure go.sum is valid and dependencies are downloaded.',
            file,
          },
        ],
      };
    }

    // Run `go mod graph` to get the complete dependency graph
    const graphOutput = await runGoModGraph(dir);
    if (!graphOutput) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [
          {
            severity: 'ERROR',
            message: 'Failed to run go mod graph. Ensure go.sum is valid and dependencies are downloaded.',
            file,
          },
        ],
      };
    }

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];
    const subprojectPurls = new Set<string>();

    // Parse the graph output
    const graphLines = graphOutput.split('\n').filter((line) => line.trim());
    const allDeps = new Set<string>(); // Track all dependencies by path@version

    for (const line of graphLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 2) continue;

      const [from, to] = parts as [string, string];

      // Parse module@version or just module (for main module)
      const fromParsed = parseModuleVersion(from);
      const toParsed = parseModuleVersion(to);

      if (!fromParsed || !toParsed) continue;

      // Normalize to module@version format for selectedModules check
      const fromNormalized = `${fromParsed.path}@${fromParsed.version ?? '0.0.0-00010101000000-000000000000'}`;
      const toNormalized = `${toParsed.path}@${toParsed.version ?? '0.0.0-00010101000000-000000000000'}`;

      // Filter: Only include edges where both endpoints are in selectedModules
      // This removes duplicate versions and keeps only MVS-selected versions
      if (!selectedModules.has(fromNormalized) || !selectedModules.has(toNormalized)) {
        continue;
      }

      // Skip go runtime and toolchain pseudo-modules
      if (fromParsed.path === 'go' || fromParsed.path === 'toolchain') continue;
      if (toParsed.path === 'go' || toParsed.path === 'toolchain') continue;

      // Create PURLs
      const fromPurl = createGoPurl(fromParsed.path, fromParsed.version);
      const toPurl = createGoPurl(toParsed.path, toParsed.version);

      // Track all dependencies
      if (toParsed.path !== moduleName && toParsed.version) {
        allDeps.add(`${toParsed.path}@${toParsed.version}`);
      }

      // Ensure packages exist
      ensurePackageExists(packageMap, fromPurl);
      ensurePackageExists(packageMap, toPurl);

      // Add relationship
      addRelationship(relationshipsMap, fromPurl, toPurl);
    }

    // Create PURL for the main module (used in subproject, not in packages)
    const modulePurl = createGoPurl(moduleName);
    subprojectPurls.add(modulePurl);

    // Add evidence for dependencies from go.mod
    const directDeps: string[] = [];
    const indirectDeps: string[] = [];

    for (const depKey of allDeps) {
      const [path, version] = depKey.split('@') as [string, string];
      const depPurl = createGoPurl(path, version);

      // Find line number for evidence
      const lineNumber = findDependencyLineNumber(lines, path, version);
      if (lineNumber !== undefined) {
        packageMap.get(depPurl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Categorize as direct or indirect
      if (directDepsSet.has(path)) {
        directDeps.push(depPurl);
      } else {
        indirectDeps.push(depPurl);
      }
    }

    // Create scopes for the subproject
    const scopes: DependencyScope[] = [];
    if (directDeps.length > 0) {
      scopes.push({
        scope: 'dependencies',
        packages: directDeps,
      });
    }
    if (indirectDeps.length > 0) {
      scopes.push({
        scope: 'indirectDependencies',
        packages: indirectDeps,
      });
    }

    // Add the module as a subproject
    subprojects.push({
      purl: modulePurl,
      definitionFile: file,
      scopes,
    });

    // Convert maps to arrays
    const allPackages = convertPackageMapToArray(packageMap);
    const packages = allPackages.filter((pkg) => !subprojectPurls.has(pkg.purl));
    const relationships = convertRelationshipsMapToArray(relationshipsMap);

    return {
      packages,
      subprojects,
      relationships,
      issues: [],
    };
  },
});

/**
 * Run `go list -m -json all` to get selected module versions
 */
async function runGoListModules(dir: string): Promise<Set<string> | null> {
  try {
    const proc = Bun.spawn(['go', 'list', '-m', '-json', 'all'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    await proc.exited;

    if (proc.exitCode !== 0) {
      console.error(`go list -m -json all failed: ${error}`);
      return null;
    }

    // Parse the JSON output - each line is a separate JSON object
    const selectedModules = new Set<string>();
    const lines = output.trim().split('\n');
    let jsonBuffer = '';

    for (const line of lines) {
      jsonBuffer += line;
      if (line.trim() === '}') {
        try {
          const module = JSON.parse(jsonBuffer);
          const path = module.Path;
          const version = module.Version || '0.0.0-00010101000000-000000000000';
          selectedModules.add(`${path}@${version}`);
          jsonBuffer = '';
        } catch {
          // Continue buffering if JSON is incomplete
        }
      }
    }

    return selectedModules;
  } catch (error) {
    console.error('Failed to run go list:', error);
    return null;
  }
}

/**
 * Run `go mod graph` in the specified directory
 */
async function runGoModGraph(dir: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['go', 'mod', 'graph'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    await proc.exited;

    if (proc.exitCode !== 0) {
      console.error(`go mod graph failed: ${error}`);
      return null;
    }

    return output;
  } catch (error) {
    console.error('Failed to run go mod graph:', error);
    return null;
  }
}

/**
 * Parse module name from go.mod content
 */
function parseModuleName(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('module ')) {
      return trimmed.substring(7).trim();
    }
  }
  return null;
}

/**
 * Parse direct dependencies (non-indirect) from go.mod
 * Returns a Set of dependency paths
 */
function parseDirectDependencies(content: string): Set<string> {
  const directDeps = new Set<string>();
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('//') || trimmed === '') continue;

    // Parse require block or single require
    if (trimmed.startsWith('require (')) {
      inRequireBlock = true;
      continue;
    }

    if (trimmed.startsWith('require ')) {
      const dep = parseRequireLine(trimmed.substring(8).trim());
      if (dep && !dep.indirect) {
        directDeps.add(dep.path);
      }
      continue;
    }

    if (inRequireBlock) {
      if (trimmed === ')') {
        inRequireBlock = false;
        continue;
      }
      const dep = parseRequireLine(trimmed);
      if (dep && !dep.indirect) {
        directDeps.add(dep.path);
      }
    }
  }

  return directDeps;
}

/**
 * Parse a single require line
 */
function parseRequireLine(line: string): Dependency | null {
  // Remove inline comments
  const commentIndex = line.indexOf('//');
  const isIndirect = commentIndex !== -1 && line.includes('// indirect');
  const cleanLine = commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line;

  // Parse "path version"
  const parts = cleanLine.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      path: parts[0],
      version: parts[1],
      indirect: isIndirect,
    };
  }

  return null;
}

/**
 * Parse "path@version" or "path" (main module) into components
 */
function parseModuleVersion(input: string): { path: string; version?: string } | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex === -1) {
    // Main module without version
    return {
      path: input,
      version: undefined,
    };
  }

  const path = input.substring(0, atIndex);
  const version = input.substring(atIndex + 1);

  if (!path || !version) return null;

  return { path, version };
}

/**
 * Find the line number where a module directive appears.
 */
function findModuleLineNumber(lines: string[], moduleName: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || '';
    if (line.startsWith('module ') && line.includes(moduleName)) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}

/**
 * Find the line number where a dependency appears in go.mod
 */
function findDependencyLineNumber(lines: string[], depPath: string, version: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || '';
    // Look for lines that contain the dependency path and version
    if (line.includes(depPath) && line.includes(version)) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}
