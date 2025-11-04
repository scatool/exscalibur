import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  filesExtractor,
  type Relationship,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { dirname, join } from 'node:path';
import { findLineNumber, parseDenoLockfile, parseJsrPackage, parseNpmPackage, type DenoLockfile } from './lockfile.ts';
import type { PackageJson } from '../types.ts';

const lockfileGlob = new Glob('**/deno.lock');

export const extractor: Extractor = filesExtractor({
  name: 'denolock',
  version: 1,
  markFiles: async function (codebase: string) {
    for await (const file of lockfileGlob.scan({ cwd: codebase, absolute: true })) {
      if (!file.includes('/node_modules/')) {
        this.markFile(file);
      }
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);

    const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
    const relationshipsMap = new Map<string, Set<string>>();
    const subprojects: Subproject[] = [];

    try {
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
          const purl = new PackageURL('generic', null, name, version, null, null).toString();

          // Extract dependency scopes
          const scopes: DependencyScope[] = [];

          // Process imports as dependencies
          if (denoConfig.imports && typeof denoConfig.imports === 'object') {
            const dependencies: string[] = [];

            for (const [alias, specifier] of Object.entries(denoConfig.imports)) {
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
          if (!packageMap.has(purl)) {
            packageMap.set(purl, { purl, evidence: new Set() });
          }

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
          if (!packageMap.has(purl)) {
            packageMap.set(purl, { purl, evidence: new Set() });
          }

          const lineNumber = findLineNumber(lockfileContent, packageKey);
          if (lineNumber) {
            packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
          }

          // Process dependencies
          if (packageEntry.dependencies && typeof packageEntry.dependencies === 'object') {
            for (const [depName, depVersion] of Object.entries(packageEntry.dependencies)) {
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

      // Add relationships from subprojects to their dependencies
      for (const subproject of subprojects) {
        if (subproject.scopes) {
          const allDeps = new Set<string>();
          for (const scope of subproject.scopes) {
            for (const pkg of scope.packages) {
              allDeps.add(pkg);
            }
          }

          if (allDeps.size > 0) {
            const existing = relationshipsMap.get(subproject.purl);
            if (existing) {
              allDeps.forEach((dep) => existing.add(dep));
            } else {
              relationshipsMap.set(subproject.purl, allDeps);
            }
          }
        }
      }
    } catch (error) {
      // Silently skip files that fail to parse
    }

    // Convert maps to arrays
    const packages = Array.from(packageMap.values()).map(({ purl, evidence }) => ({
      purl,
      evidence: Array.from(evidence),
    }));

    const relationships: Relationship[] = Array.from(relationshipsMap.entries()).map(([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    }));

    return {
      packages,
      subprojects,
      relationships,
      issues: [],
    };
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
 * Add a relationship to the relationships map
 */
function addRelationship(relationshipsMap: Map<string, Set<string>>, from: string, to: string): void {
  const existing = relationshipsMap.get(from);
  if (existing) {
    existing.add(to);
  } else {
    relationshipsMap.set(from, new Set([to]));
  }
}

/**
 * Ensure a package exists in the package map
 */
function ensurePackageExists(packageMap: Map<string, { purl: string; evidence: Set<string> }>, purl: string): void {
  if (!packageMap.has(purl)) {
    packageMap.set(purl, { purl, evidence: new Set() });
  }
}

/**
 * Create a JSR PURL
 */
function createJsrPurl(scope: string, name: string, version: string): string {
  // JSR uses @scope/name format, so we use the scope as namespace (without @)
  const namespace = scope.startsWith('@') ? scope.slice(1) : scope;
  return new PackageURL('jsr', namespace, name, version, null, null).toString();
}

/**
 * Create an npm PURL
 */
function createNpmPurl(name: string, version: string): string {
  let namespace: string | null = null;
  let packageName = name;

  if (name.startsWith('@')) {
    const parts = name.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      namespace = parts[0];
      packageName = parts[1];
    }
  }

  return new PackageURL('npm', namespace, packageName, version, null, null).toString();
}
