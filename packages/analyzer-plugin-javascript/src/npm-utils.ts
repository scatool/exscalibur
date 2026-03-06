import { PackageURL } from 'packageurl-js';
import type { DependencyScope } from '@scatool/analyzer-core/src/index.ts';

export const NPM_DEPENDENCY_SCOPES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export function createNpmPurl(name: string, version: string): string {
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

/** Iterates NPM_DEPENDENCY_SCOPES, resolving each dep via the callback (returns PURL or null to skip). */
export function extractNpmScopes(
  packageInfo: Record<string, unknown>,
  resolveDep: (depName: string, versionRange: string) => string | null,
): DependencyScope[] {
  const scopes: DependencyScope[] = [];

  for (const scopeName of NPM_DEPENDENCY_SCOPES) {
    const deps = packageInfo[scopeName];
    if (!deps || typeof deps !== 'object') continue;

    const scopePackages: string[] = [];
    for (const [depName, versionRange] of Object.entries(deps)) {
      if (typeof versionRange !== 'string') continue;
      const purl = resolveDep(depName, versionRange);
      if (purl) scopePackages.push(purl);
    }

    if (scopePackages.length > 0) {
      scopes.push({ scope: scopeName, packages: scopePackages });
    }
  }

  return scopes;
}
