import {type AnalyzerResult, type Extractor, filesExtractor} from '@scatool/analyzer-core/src/index.ts';
import {Glob} from 'bun';
import {PackageURL} from 'packageurl-js';
import {dirname} from 'node:path';

const lockfileGlob = new Glob('**/{package-lock.json,npm-shrinkwrap.json}');

export const extractor: Extractor = filesExtractor({
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({cwd: codebase, absolute: true})) {
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const packages: string[] = [];

    try {
      // Run npm ls to get the dependency tree from package-lock.json only
      const proc = Bun.spawn(['npm', 'ls', '--json', '--all', '--package-lock-only'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      // Parse the npm ls output
      const result = JSON.parse(output);

      // Extract packages from the dependency tree recursively
      const extractPackages = (deps: any) => {
        if (!deps || typeof deps !== 'object') {
          return;
        }

        for (const [name, info] of Object.entries(deps)) {
          if (typeof info === 'object' && info !== null && 'version' in info) {
            const version = (info as any).version;
            if (typeof version === 'string') {
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

            // Recursively process dependencies
            if ('dependencies' in info) {
              extractPackages((info as any).dependencies);
            }
          }
        }
      };

      // Extract packages from the result
      if (result.dependencies) {
        extractPackages(result.dependencies);
      }
    } catch (error) {
      // If npm ls fails, skip this file
      console.error(`Failed to run npm ls in ${dir}:`, error);
    }

    return {
      packages,
    };
  },
});
