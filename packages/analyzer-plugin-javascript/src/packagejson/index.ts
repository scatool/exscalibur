import { type Extractor, filesExtractor, type AnalyzerResult } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';

export const extractor: Extractor = filesExtractor({
  name: 'packagejson',
  version: 1,
  markFiles: async function (codebase: string) {
    // Find all package.json files in the codebase
    const glob = new Glob('**/package.json');

    for await (const file of glob.scan({
      cwd: codebase,
      absolute: true,
    })) {
      // Skip node_modules
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    // Process individual package.json file
    const content = await Bun.file(file).text();
    const packageJson = JSON.parse(content);
    const lines = content.split('\n');

    const packages = [];

    // Extract dependencies (no version resolution, just what's declared)
    const depSections = [
      packageJson.dependencies,
      packageJson.devDependencies,
      packageJson.peerDependencies,
      packageJson.optionalDependencies,
    ];

    for (const deps of depSections) {
      if (deps && typeof deps === 'object') {
        for (const [name, versionRange] of Object.entries(deps)) {
          if (typeof versionRange === 'string') {
            // Remove workspace: prefix if present
            let cleanVersion = versionRange.replace(/^workspace:/, '');

            // Strip version range prefixes (^, ~, >=, <=, >, <, =)
            cleanVersion = cleanVersion.replace(/^[\^~>=<]+/, '');

            // Handle version ranges like "1.0.0 - 2.0.0" or ">=1.0.0 <2.0.0"
            // Take the first version in the range
            if (cleanVersion.includes(' ')) {
              const firstPart = cleanVersion.split(/\s+/)[0];
              if (firstPart) {
                cleanVersion = firstPart.replace(/^[\^~>=<]+/, '');
              }
            }

            // Create a proper Package URL (PURL)
            let namespace: string | null = null;
            let packageName = name;
            if (name.startsWith('@')) {
              const parts = name.split('/');
              if (parts.length === 2 && parts[0] && parts[1]) {
                namespace = parts[0]; // Keep @ for proper PURL encoding
                packageName = parts[1];
              }
            }

            const purl = new PackageURL('npm', namespace, packageName, cleanVersion, null, null);

            // Find line number for evidence
            const lineNumber = findLineNumber(lines, name);
            const evidence = lineNumber ? [`${file}:${lineNumber}`] : undefined;

            packages.push({
              purl: purl.toString(),
              evidence
            });
          }
        }
      }
    }

    return {
      packages,
    };
  },
});

// Find the line number where a package is declared
function findLineNumber(lines: string[], packageName: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "packageName": or 'packageName':
    if (
      line &&
      (line.includes(`"${packageName}"`) || line.includes(`'${packageName}'`))
    ) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}
