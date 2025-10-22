import {type AnalyzerResult, type Extractor, type Subproject, filesExtractor} from '@scatool/analyzer-core/src/index.ts';
import {Glob} from 'bun';
import {PackageURL} from 'packageurl-js';
import {parse} from 'jsonc-parser';
import {dirname, join} from 'node:path';

const glob = new Glob('**/bun.lock');

export const extractor: Extractor = filesExtractor({
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of glob.scan({cwd: codebase, absolute: true})) {
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const dir = dirname(file);

    // Parse the bun.lock file (JSONC format with comments and trailing commas)
    const lockfile = parse(content);

    // Extract package information from the packages section
    const packages: string[] = [];
    const subprojects: Subproject[] = [];

    // Read package.json to get the root package info
    const packageJsonPath = join(dir, 'package.json');
    let rootPackageInfo: any = null;
    try {
      const packageJsonContent = await Bun.file(packageJsonPath).text();
      rootPackageInfo = JSON.parse(packageJsonContent);
    } catch {
      // package.json might not exist, continue anyway
    }

    // Extract root package as a subproject if it has name and version
    if (rootPackageInfo && rootPackageInfo.name && rootPackageInfo.version) {
      const name = rootPackageInfo.name;
      const version = rootPackageInfo.version;

      // Create a proper Package URL (PURL)
      let namespace: string | null = null;
      let packageName = name;
      if (name.startsWith('@')) {
        const parts = name.split('/');
        if (parts.length === 2 && parts[0] && parts[1]) {
          namespace = parts[0].substring(1); // Remove @ prefix
          packageName = parts[1];
        }
      }
      const purl = new PackageURL('npm', namespace, packageName, version, null, null);
      subprojects.push({
        purl: purl.toString(),
        definitionFile: packageJsonPath,
      });
    }

    if (lockfile.packages && typeof lockfile.packages === 'object') {
      for (const [, packageInfo] of Object.entries(lockfile.packages)) {
        if (Array.isArray(packageInfo) && packageInfo.length > 0) {
          // First element is the package identifier (name@version)
          const packageIdentifier = packageInfo[0];
          if (typeof packageIdentifier === 'string') {
            // Parse name@version format
            const lastAtIndex = packageIdentifier.lastIndexOf('@');
            if (lastAtIndex > 0) {
              const name = packageIdentifier.substring(0, lastAtIndex);
              const version = packageIdentifier.substring(lastAtIndex + 1);

              // Create a proper Package URL (PURL)
              // For scoped packages (@scope/name), extract scope as namespace
              let namespace: string | null = null;
              let packageName = name;
              if (name.startsWith('@')) {
                const parts = name.split('/');
                if (parts.length === 2 && parts[0] && parts[1]) {
                  namespace = parts[0].substring(1); // Remove @ prefix
                  packageName = parts[1];
                }
              }
              const purl = new PackageURL('npm', namespace, packageName, version, null, null);
              packages.push(purl.toString());
            }
          }
        }
      }
    }

    return {
      packages,
      subprojects: subprojects.length > 0 ? subprojects : undefined,
    };
  },
});
