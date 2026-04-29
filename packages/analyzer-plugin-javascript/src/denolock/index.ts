import {
  addRelationship,
  type AnalyzerResult,
  buildResult,
  type DependencyScope,
  ensurePackageExists,
  type Extractor,
  filesExtractor,
  initializeExtractionMaps,
  scanAndMarkFiles,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path';
import { type DenoLockfile, findLineNumber, parseDenoLockfile, parseJsrPackage, parseNpmPackage } from './lockfile.ts';
import { createNpmPurl } from '../npm-utils.ts';
import type { JavaScriptOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

export const extractor: Extractor<JavaScriptOptions> = filesExtractor<JavaScriptOptions>({
  name: 'denolock',
  version: 1,
  options: async () => ({
    ignore: ['**/node_modules/**'],
  }),
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: JavaScriptOptions) {
    await scanAndMarkFiles(this, codebase, '**/deno.lock', options.ignore ?? []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    const lockfileContent = await Bun.file(file).text();
    const lockfile = parseDenoLockfile(lockfileContent);

    // Process workspace subproject if deno.json exists
    const denoJsonPath = join(dir, 'deno.json');
    const denoJsoncPath = join(dir, 'deno.jsonc');

    let denoConfigPath: string | null = null;
    try {
      await Bun.file(denoJsonPath).text();
      denoConfigPath = denoJsonPath;
    } catch {
      try {
        await Bun.file(denoJsoncPath).text();
        denoConfigPath = denoJsoncPath;
      } catch {
        // No deno config file found
      }
    }

    // If we have a deno config, try to extract subproject info
    if (denoConfigPath) {
      try {
        const denoConfigContent = await Bun.file(denoConfigPath).text();
        const denoConfig = JSON.parse(denoConfigContent);

        // Extract name and version from deno.json if available
        const name = denoConfig.name || 'deno-project';
        const version = denoConfig.version || '0.0.0';

        // Create PURL for the subproject (use generic type for Deno projects)
        const purl = createPurl('generic', name, version);

        // Extract dependency scopes
        const scopes: DependencyScope[] = [];

        // Process imports as dependencies
        if (denoConfig.imports && typeof denoConfig.imports === 'object') {
          const dependencies: string[] = [];

          for (const [, specifier] of Object.entries(denoConfig.imports)) {
            if (typeof specifier === 'string') {
              // Resolve specifier to actual package
              let depPurl: string | null = null;

              if (specifier.startsWith('jsr:')) {
                const resolved = resolveJsrSpecifier(lockfile, specifier);
                if (resolved) {
                  depPurl = createJsrPurl(resolved.scope, resolved.name, resolved.version);
                }
              } else if (specifier.startsWith('npm:')) {
                const resolved = resolveNpmSpecifier(lockfile, specifier);
                if (resolved) {
                  depPurl = createNpmPurl(resolved.name, resolved.version);
                }
              }

              if (depPurl) {
                dependencies.push(depPurl);
              }
            }
          }

          if (dependencies.length > 0) {
            scopes.push({
              scope: 'dependencies',
              packages: dependencies,
            });
          }
        }

        subprojects.push({
          purl,
          definitionFile: denoConfigPath,
          scopes,
        });
      } catch {
        // Failed to parse deno.json
      }
    }

    // Process JSR packages
    if (lockfile.packages?.jsr) {
      for (const [packageKey, packageEntry] of Object.entries(lockfile.packages.jsr)) {
        const parsed = parseJsrPackage(packageKey);
        if (!parsed) continue;

        const { scope, name, version } = parsed;
        const purl = createJsrPurl(scope, name, version);

        // Add package with evidence
        ensurePackageExists(packageMap, purl);

        const lineNumber = findLineNumber(lockfileContent, packageKey);
        if (lineNumber) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Process dependencies
        if (packageEntry.dependencies && Array.isArray(packageEntry.dependencies)) {
          for (const dep of packageEntry.dependencies) {
            if (typeof dep === 'string') {
              const depResolved = resolveJsrSpecifier(lockfile, dep);
              if (depResolved) {
                const depPurl = createJsrPurl(depResolved.scope, depResolved.name, depResolved.version);
                addRelationship(relationshipsMap, purl, depPurl);
                ensurePackageExists(packageMap, depPurl);
              }
            }
          }
        }
      }
    }

    // Process npm packages
    if (lockfile.packages?.npm) {
      for (const [packageKey, packageEntry] of Object.entries(lockfile.packages.npm)) {
        const parsed = parseNpmPackage(packageKey);
        if (!parsed) continue;

        const { name, version } = parsed;
        const purl = createNpmPurl(name, version);

        // Add package with evidence
        ensurePackageExists(packageMap, purl);

        const lineNumber = findLineNumber(lockfileContent, packageKey);
        if (lineNumber) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Process dependencies
        if (packageEntry.dependencies && typeof packageEntry.dependencies === 'object') {
          for (const [, depVersion] of Object.entries(packageEntry.dependencies)) {
            if (typeof depVersion === 'string') {
              const depParsed = parseNpmPackage(depVersion);
              if (depParsed) {
                const depPurl = createNpmPurl(depParsed.name, depParsed.version);
                addRelationship(relationshipsMap, purl, depPurl);
                ensurePackageExists(packageMap, depPurl);
              }
            }
          }
        }
      }
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

/**
 * Resolve a JSR specifier to actual package info using the lockfile
 */
function resolveJsrSpecifier(
  lockfile: DenoLockfile,
  specifier: string,
): { scope: string; name: string; version: string } | null {
  // First try to resolve from specifiers map
  if (lockfile.packages?.specifiers) {
    const resolved = lockfile.packages.specifiers[specifier];
    if (resolved) {
      return parseJsrPackage(resolved);
    }
  }

  // Try to parse the specifier directly
  return parseJsrPackage(specifier);
}

/**
 * Resolve an npm specifier to actual package info using the lockfile
 */
function resolveNpmSpecifier(lockfile: DenoLockfile, specifier: string): { name: string; version: string } | null {
  // First try to resolve from specifiers map
  if (lockfile.packages?.specifiers) {
    const resolved = lockfile.packages.specifiers[specifier];
    if (resolved) {
      return parseNpmPackage(resolved);
    }
  }

  // Try to parse the specifier directly
  return parseNpmPackage(specifier);
}

/**
 * Creates a generic Package URL (PURL) for any package type.
 * @param type - The package type (e.g., "jsr", "generic")
 * @param name - The package name
 * @param version - The package version
 * @param namespace - Optional namespace for the package
 */
function createPurl(type: string, name: string, version: string, namespace: string | null = null): string {
  return new PackageURL(type, namespace, name, version, null, null).toString();
}

/**
 * Create a JSR PURL
 */
function createJsrPurl(scope: string, name: string, version: string): string {
  // JSR uses @scope/name format, so we use the scope as namespace (without @)
  const namespace = scope.startsWith('@') ? scope.slice(1) : scope;
  return createPurl('jsr', name, version, namespace);
}
