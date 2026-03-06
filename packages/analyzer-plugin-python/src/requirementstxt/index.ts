import {
  type AnalyzerResult,
  type Extractor,
  filesExtractor,
  scanAndMarkFiles,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  initializeExtractionMaps,
} from '@scatool/analyzer-core/src/index.ts';
import { createPypiPurl } from '../python-utils.ts';
import type { PythonOptions } from '../options.ts';

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: 'requirementstxt',
  version: 1,
  options: async () => ({
    ignore: ['**/.venv/**', '**/venv/**', '**/__pycache__/**'],
  }),
  markFiles: async function (codebase: string, options: PythonOptions) {
    await scanAndMarkFiles(this, codebase, '**/requirements*.txt', options.ignore ?? []);
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

  if (!line) return null;

  // Skip URLs and VCS references
  if (
    line.includes('git+') ||
    line.includes('hg+') ||
    line.includes('svn+') ||
    line.includes('bzr+') ||
    /^https?:\/\//.test(line)
  ) {
    return null;
  }

  // Skip lines with @ URL syntax (e.g. "pip @ https://..." or "name @ gopher://...")
  if (/@\s*https?:\/\//.test(line) || /@\s*\w+:\/\//.test(line)) {
    return null;
  }

  // Package name must start with a letter or digit (PEP 508)
  if (!/^[a-zA-Z0-9]/.test(line)) {
    return null;
  }

  // Extract package name: everything up to the first version specifier, extra bracket, or semicolon
  const nameMatch = line.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  // Parse version specifiers
  // Try to extract exact version (==)
  const exactMatch = line.match(/==\s*([0-9][^\s,;]*)/);
  if (exactMatch) {
    return { name, version: exactMatch[1] };
  }

  // Try other operators and extract version
  const versionMatch = line.match(/[><=!~]+\s*([0-9][^\s,;]*)/);
  if (versionMatch) {
    return { name, version: versionMatch[1] };
  }

  // No version specified
  return { name, version: '0.0.0' };
}
