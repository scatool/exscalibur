export interface VcpkgPackageInfoResult {
  results: Record<string, VcpkgPackageInfo>;
}

/**
 * VcpkgPackageInfo models the schema defined in vcpkg.json
 * Reference: https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json
 * Schema: https://raw.githubusercontent.com/microsoft/vcpkg-tool/main/docs/vcpkg.schema.json
 */
export interface VcpkgPackageInfo {
  /**
   * The name of the top-level package
   * Must be lowercase ASCII letters, digits, or hyphens
   */
  name: string;

  /**
   * Package version - exactly one version field should be set for libraries
   */
  version?: string;
  'version-semver'?: string;
  'version-date'?: string;
  'version-string'?: string;

  /**
   * Port files revision distinguishing packaging revisions
   */
  'port-version'?: number;

  /**
   * The description of the port
   * Can be a string or array of strings
   */
  description?: string | string[];

  /**
   * A shorter description of the port or project
   */
  summary?: string;

  /**
   * URI to the upstream project's homepage
   */
  homepage?: string;

  /**
   * URI to the upstream project's documentation
   */
  documentation?: string;

  /**
   * SPDX license expression or null
   */
  license?: string | null;

  /**
   * List of package maintainers
   * Can be a string or array of strings
   */
  maintainers?: string | string[];

  /**
   * Shortcut for specifying the baseline commit for version resolution
   */
  'builtin-baseline'?: string;

  /**
   * Dependencies required to build and use this project
   */
  dependencies?: Dependency[];

  /**
   * Version overrides for specific dependencies
   */
  overrides?: Override[];

  /**
   * Map of features available for users of the project
   */
  features?: Record<string, Feature>;

  /**
   * Default features enabled with the package
   */
  'default-features'?: DependencyFeature[];

  /**
   * Supported platform and build configurations
   */
  supports?: string;

  /**
   * Embedded vcpkg configuration
   */
  configuration?: VcpkgConfiguration;

  /**
   * Alias for configuration field (older spelling)
   */
  'vcpkg-configuration'?: VcpkgConfiguration;
}

export type Dependency = string | DependencyObject;

export interface DependencyObject {
  /**
   * The name of the dependency
   */
  name: string;

  /**
   * List of additional features to require
   */
  features?: DependencyFeature[];

  /**
   * Whether dependency is for host machine instead of target
   */
  host?: boolean;

  /**
   * Whether to require the on-by-default features
   */
  'default-features'?: boolean;

  /**
   * Platform expression limiting where dependency is required
   */
  platform?: string;

  /**
   * Minimum required version
   */
  'version>='?: string;
}

export type DependencyFeature = string | DependencyFeatureObject;

export interface DependencyFeatureObject {
  /**
   * The name of the feature
   */
  name: string;

  /**
   * Platform expression limiting where feature is required
   */
  platform?: string;
}

export interface Override {
  /**
   * The port name to override
   */
  name: string;

  /**
   * Version to pin (exactly one version field should be set)
   */
  version?: string;
  'version-semver'?: string;
  'version-date'?: string;
  'version-string'?: string;

  /**
   * Port files revision to pin
   */
  'port-version'?: number;
}

export interface Feature {
  /**
   * Description of the feature
   */
  description: string | string[];

  /**
   * Dependencies required by this feature
   */
  dependencies?: Dependency[];

  /**
   * Supported platform and build configurations for this feature
   */
  supports?: string;

  /**
   * SPDX license expression for this feature
   */
  license?: string | null;
}

/**
 * Embedded vcpkg configuration
 */
export interface VcpkgConfiguration {
  /**
   * List of port registries
   */
  registries?: Registry[];

  /**
   * List of overlay port directories
   */
  'overlay-ports'?: string[];

  /**
   * List of overlay triplet files
   */
  'overlay-triplets'?: string[];

  /**
   * Artifact registry configuration
   */
  'artifact-registry'?: ArtifactRegistry;

  /**
   * Artifact caching configuration
   */
  'artifact-caching'?: ArtifactCaching;
}

export type Registry = BuiltinRegistry | GitRegistry | FilesystemRegistry;

export interface BuiltinRegistry {
  /**
   * Registry kind identifier
   */
  kind: 'builtin';

  /**
   * Baseline commit SHA for version resolution
   */
  baseline: string;
}

export interface GitRegistry {
  /**
   * Registry kind identifier
   */
  kind: 'git';

  /**
   * Git repository URI
   */
  repository: string;

  /**
   * Baseline commit SHA for version resolution
   */
  baseline: string;

  /**
   * Git reference to fetch
   */
  reference?: string;
}

export interface FilesystemRegistry {
  /**
   * Registry kind identifier
   */
  kind: 'filesystem';

  /**
   * Filesystem path to registry
   */
  path: string;

  /**
   * Key in baseline.json for version selection
   */
  baseline?: string;
}

export interface ArtifactRegistry {
  /**
   * Artifact registry kind
   */
  kind: 'artifact';

  /**
   * Artifact registry name
   */
  name: string;

  /**
   * URI to artifact registry location
   */
  location: string;
}

export interface ArtifactCaching {
  /**
   * Artifact caching kind
   */
  kind?: string;

  /**
   * Configuration for artifact caching
   */
  [key: string]: unknown;
}
