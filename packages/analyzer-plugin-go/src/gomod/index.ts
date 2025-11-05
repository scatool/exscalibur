import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  createGoPurl,
  addRelationship,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { dirname } from 'node:path';

const glob = new Glob('**/go.mod');

type Dependency = {
  path: string;
  version: string;
  indirect: boolean;
};

type ReplaceDirective = {
  old: string;
  new: string;
};

type GoMod = {
  module: string;
  goVersion: string;
  require: Dependency[];
  replace: ReplaceDirective[];
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

    const goMod = parseGoMod(content);
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    // Build a map of replace directives for resolution
    const replaceMap = new Map<string, string>();
    for (const replace of goMod.replace) {
      replaceMap.set(replace.old, replace.new);
    }

    // Create the main module as a subproject
    // For Go modules, we use a pseudo-version since the module itself doesn't have a version
    // until it's published or tagged
    const modulePurl = createGoPurl(goMod.module, '0.0.0-00010101000000-000000000000');

    // Separate direct and indirect dependencies
    const directDeps: string[] = [];
    const indirectDeps: string[] = [];

    for (const dep of goMod.require) {
      // Skip replaced local modules (they start with ./ or ../)
      const replacement = replaceMap.get(dep.path);
      if (replacement && (replacement.startsWith('./') || replacement.startsWith('../'))) {
        // This is a local replacement, we'll handle it separately
        continue;
      }

      const depVersion = replacement || dep.version;
      const depPurl = createGoPurl(dep.path, depVersion);

      // Add to package map
      ensurePackageExists(packageMap, depPurl);

      // Find line number for evidence
      const lineNumber = findDependencyLineNumber(lines, dep.path, dep.version);
      if (lineNumber !== undefined) {
        packageMap.get(depPurl)!.evidence.add(`${file}#${lineNumber}`);
      }

      // Add to appropriate dependency list
      if (dep.indirect) {
        indirectDeps.push(depPurl);
      } else {
        directDeps.push(depPurl);
      }

      // Add relationship from module to dependency
      addRelationship(relationshipsMap, modulePurl, depPurl);
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

    // Ensure the module itself is in the package map
    ensurePackageExists(packageMap, modulePurl);
    const moduleLineNumber = findModuleLineNumber(lines, goMod.module);
    if (moduleLineNumber !== undefined) {
      packageMap.get(modulePurl)!.evidence.add(`${file}#${moduleLineNumber}`);
    }

    // Convert maps to arrays
    const packages = convertPackageMapToArray(packageMap);
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
 * Parse a go.mod file into a structured format
 */
function parseGoMod(content: string): GoMod {
  const lines = content.split('\n');
  let module = '';
  let goVersion = '';
  const require: Dependency[] = [];
  const replace: ReplaceDirective[] = [];

  let inRequireBlock = false;
  let inReplaceBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || '';

    // Skip comments and empty lines
    if (line.startsWith('//') || line === '') continue;

    // Parse module directive
    if (line.startsWith('module ')) {
      module = line.substring(7).trim();
      continue;
    }

    // Parse go version directive
    if (line.startsWith('go ')) {
      goVersion = line.substring(3).trim();
      continue;
    }

    // Parse require block or single require
    if (line.startsWith('require (')) {
      inRequireBlock = true;
      continue;
    }
    if (line.startsWith('require ')) {
      const dep = parseRequireLine(line.substring(8).trim());
      if (dep) require.push(dep);
      continue;
    }
    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      const dep = parseRequireLine(line);
      if (dep) require.push(dep);
      continue;
    }

    // Parse replace block or single replace
    if (line.startsWith('replace (')) {
      inReplaceBlock = true;
      continue;
    }
    if (line.startsWith('replace ')) {
      const rep = parseReplaceLine(line.substring(8).trim());
      if (rep) replace.push(rep);
      continue;
    }
    if (inReplaceBlock) {
      if (line === ')') {
        inReplaceBlock = false;
        continue;
      }
      const rep = parseReplaceLine(line);
      if (rep) replace.push(rep);
      continue;
    }
  }

  return { module, goVersion, require, replace };
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
 * Parse a single replace line
 */
function parseReplaceLine(line: string): ReplaceDirective | null {
  // Remove inline comments
  const commentIndex = line.indexOf('//');
  const cleanLine = commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line;

  // Parse "old [version] => new [version]"
  const parts = cleanLine.split('=>').map((p) => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  // Extract just the module paths (ignore versions)
  const oldParts = parts[0].split(/\s+/);
  const newParts = parts[1].split(/\s+/);

  if (oldParts[0] && newParts[0]) {
    return {
      old: oldParts[0],
      new: newParts[0],
    };
  }

  return null;
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
