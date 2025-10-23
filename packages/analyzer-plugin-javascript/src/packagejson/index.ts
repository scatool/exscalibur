import { type Extractor, filesExtractor, type AnalyzerResult } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';

export const extractor: Extractor = filesExtractor({
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
            // For package.json, we use the version range as specified
            // Remove workspace: prefix if present
            const cleanVersion = versionRange.replace(/^workspace:/, '');

            // Create a proper Package URL (PURL)
            // Note: version ranges are supported in PURLs
            let namespace: string | null = null;
            let packageName = name;
            if (name.startsWith('@')) {
              const parts = name.split('/');
              if (parts.length === 2 && parts[0] && parts[1]) {
                namespace = parts[0].substring(1);
                packageName = parts[1];
              }
            }
            const purl = new PackageURL('npm', namespace, packageName, cleanVersion, null, null);
            packages.push({ purl: purl.toString() });
          }
        }
      }
    }

    return {
      packages,
    };
  },
});
