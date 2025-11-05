/**
 * Standard npm dependency scope names.
 * These correspond to the dependency types in package.json files.
 */
export const NPM_DEPENDENCY_SCOPES = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/**
 * Type representing valid npm dependency scopes
 */
export type NpmDependencyScope = (typeof NPM_DEPENDENCY_SCOPES)[number];
