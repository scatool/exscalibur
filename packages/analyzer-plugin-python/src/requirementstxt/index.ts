import {
  type AnalyzerResult,
  type Extractor,
  filesExtractor,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { createPypiPurl } from '../python-utils.ts';
import type { PythonOptions } from '../options.ts';

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: 'requirementstxt',
  version: 1,
  options: async () => ({
    ignore: ['**/.venv/**', '**/venv/**', '**/__pycache__/**'],
  }),
  markFiles: async function (codebase: string, options: PythonOptions) {
    const ignorePatterns = options.ignore ?? [];
    const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

    const glob = new Glob('**/requirements*.txt');
    for await (const file of glob.scan({ cwd: codebase, absolute: true, onlyFiles: true })) {
      const shouldIgnore = ignoreGlobs.some((glob) => glob.match(file));
      if (!shouldIgnore) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const lines = content.split('\n');

    const { packageMap, relationshipsMap } = initializeExtractionMaps();

    // Parse requirements.txt
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') continue;

      // Skip options like -e, -r, --index-url, etc.
      if (trimmed.startsWith('-')) continue;

      // Parse dependency specification
      const dep = parseDependency(trimmed);
      if (!dep) continue;

      const { name, version } = dep;
      const purl = createPypiPurl(name, version);
      ensurePackageExists(packageMap, purl);

      // Add evidence
      packageMap.get(purl)!.evidence.add(`${file}#${i + 1}`);
    }

    // Note: requirements.txt files don't define subprojects
    // They only list packages without project metadata
    // Therefore, we don't create subprojects for requirements.txt files

    const packageArray = convertPackageMapToArray(packageMap);
    const relationships = convertRelationshipsMapToArray(relationshipsMap);

    return {
      packages: packageArray,
      subprojects: [],
      relationships,
      issues: [],
    };
  },
});

interface ParsedDependency {
  name: string;
  version: string;
}

/**
 * Parse a dependency line from requirements.txt
 * Supports formats like:
 * - package-name==1.2.3
 * - package-name>=1.2.3
 * - package-name
 * - package-name[extra]==1.2.3
 */
function parseDependency(line: string): ParsedDependency | null {
  line = line.trim();
  if (!line) return null;

  // Remove inline comments
  const commentIndex = line.indexOf('#');
  if (commentIndex !== -1) {
    line = line.substring(0, commentIndex).trim();
  }

  // Handle git URLs and other VCS references - skip for now
  if (line.includes('git+') || line.includes('hg+') || line.includes('svn+') || line.includes('bzr+')) {
    return null;
  }

  // Handle extras: package[extra]==1.2.3
  let name = line;
  const bracketIndex = line.indexOf('[');
  if (bracketIndex !== -1) {
    name = line.substring(0, bracketIndex);
  }

  // Parse version specifiers
  // Try to extract exact version (==)
  const exactMatch = line.match(/==\s*([0-9][^\s,;]*)/);
  if (exactMatch) {
    const version = exactMatch[1];
    return { name, version };
  }

  // Try other operators and extract version
  const versionMatch = line.match(/[><=!~]+\s*([0-9][^\s,;]*)/);
  if (versionMatch) {
    const version = versionMatch[1];
    return { name, version };
  }

  // No version specified - use a placeholder
  // In a real scenario, this would need resolution
  return { name, version: '0.0.0' };
}
