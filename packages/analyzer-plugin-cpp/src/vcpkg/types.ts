/**
 * VcpkgPackageInfo models the schema defined in vcpkg.json
 * Reference: https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json
 * Schema: https://raw.githubusercontent.com/microsoft/vcpkg-tool/main/docs/vcpkg.schema.json
 */
export type VcpkgPort = {
  /**
   * The name of the top-level package
   * Is required for libraries, but optional for executables.
   */
  name?: VcpkgIdentifier;
  /**
   * Text used to identify an arbitrary version
   */
  'version-string'?: string;
  /**
   * A relaxed version string (1.2.3.4...)
   */
  version?: string;
  /**
   * A date version string (e.g. 2020-01-20)
   */
  'version-date'?: string;
  /**
   * A semantic version string. See https://semver.org/
   */
  'version-semver'?: string;
  /**
   * A non-negative integer indicating the port revision. If this field doesn't exist, it's assumed to be `0`.
   */
  'port-version'?: number;
  /**
   * An array of strings which contain the maintainers of a package
   */
  maintainers?: string | string[];
  /**
   * A shorter description of the port or project.
   */
  summary?: string;
  /**
   * A string or array of strings containing the description of a package or feature.
   */
  description?: string | string[];
  /**
   * A url which points to the homepage of a package.
   */
  homepage?: string;
  /**
   * A url which points to the documentation of a package.
   */
  documentation?: string;
  /**
   * An SPDX license expression at version 3.9.
   */
  license?: string | null;
  /**
   * A vcpkg repository commit for version control.
   */
  'builtin-baseline'?: string;
  /**
   * Dependencies that are always required.
   */
  dependencies?: (VcpkgIdentifier | VcpkgDependencyObject)[];
  /**
   * Version overrides for dependencies.
   */
  overrides?: VcpkgOverride[];
  /**
   * A map of features supported by the package
   */
  features?: Record<string, VcpkgFeature>;
  /**
   * Features enabled by default with the package.
   */
  'default-features'?: (VcpkgIdentifier | VcpkgDependencyFeatureObject)[];

  /**
   * A specification of a set of platforms. See https://learn.microsoft.com/vcpkg/reference/vcpkg-json#platform-expression.
   */
  supports?: string;

  /**
   * Either configuration or vcpkg-configuration can be used. Setting both is not supported.
   */
  configuration?: VcpkgConfiguration;

  /**
   * Either configuration or vcpkg-configuration can be used. Setting both is not supported.
   */
  'vcpkg-configuration'?: VcpkgConfiguration;
};

export type VcpkgIdentifier = string;

export type VcpkgOverride = {
  /**
   * Identifiers used for port and feature names.
   */
  name: VcpkgIdentifier;
  /**
   * Deprecated in favor of 'version' in overrides. Text used to identify an arbitrary version
   */
  'version-string'?: string;
  /**
   * Text used to identify the overridden version.
   */
  version?: string;
  /**
   * Deprecated in favor of 'version' in overrides. A date version string (e.g. 2020-01-20).
   */
  'version-date'?: string;
  /**
   * Deprecated in favor of 'version' in overrides. A semantic version string. See https://semver.org/
   */
  'version-semver'?: string;
  /**
   * A non-negative integer indicating the port revision. If this field doesn't exist, it's assumed to be `0`.
   */
  'port-version'?: number;
};

export type VcpkgDefaultRegistry = VcpkgBuiltinRegistry | VcpkgGitRegistry | VcpkgFilesystemRegistry;

export type VcpkgRegistryItem =
  | VcpkgArtifactRegistry
  | ({
      packages: string[];
    } & (VcpkgBuiltinRegistry | VcpkgGitRegistry | VcpkgFilesystemRegistry));

/**
 * Expanded form of a dependency with explicit features and platform.
 */
export interface VcpkgDependencyObject {
  /**
   * Identifiers used for port and feature names.
   */
  name: VcpkgIdentifier;
  features?: VcpkgDependencyFeatureObject[];
  host?: boolean;
  'default-features'?: boolean;
  /**
   * A specification of a set of platforms. See https://learn.microsoft.com/vcpkg/reference/vcpkg-json#platform-expression.
   */
  platform?: string;
  /**
   * Minimum required version
   */
  'version>='?: string;
}
/**
 * Expanded form of a dependency feature with platform expression.
 */
export interface VcpkgDependencyFeatureObject {
  /**
   * Identifiers used for port and feature names.
   */
  name: VcpkgIdentifier;
  /**
   * A specification of a set of platforms. See https://learn.microsoft.com/vcpkg/reference/vcpkg-json#platform-expression.
   */
  platform?: string;
}
/**
 * A package feature that can be selected by consumers.
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "".
 */
export interface VcpkgFeature {
  /**
   * A string or array of strings containing the description of a package or feature.
   */
  description: string | string[];
  /**
   * Dependencies used by this feature.
   */
  dependencies?: VcpkgDependencyObject[];
  /**
   * A specification of a set of platforms. See https://learn.microsoft.com/vcpkg/reference/vcpkg-json#platform-expression.
   */
  supports?: string;
  /**
   * An SPDX license expression at version 3.9.
   */
  license?: string | null;
}
/**
 * Embedded vcpkg.configuration.json file.
 */
export interface VcpkgConfiguration {
  'default-registry'?: VcpkgDefaultRegistry;
  registries?: VcpkgRegistryItem[];
  /**
   * An error message to print if this entry is evaluated.
   */
  error?: string;
  /**
   * A warning message to print if this entry is evaluated.
   */
  warning?: string;
  /**
   * A message to print if this entry is evaluated.
   */
  message?: string;
  /**
   * An array of port overlay paths.
   */
  'overlay-ports'?: string[];
  /**
   * An array of triplet overlay paths.
   */
  'overlay-triplets'?: string[];
  requires?: VcpkgArtifactReferences;
}

export interface VcpkgBuiltinRegistry {
  kind: 'builtin';
  /**
   * The SHA that will be checked out to find default versions for ports from this registry.
   */
  baseline: string;
}

/**
 * A port registry backed by a git repo.
 */
export interface VcpkgGitRegistry {
  kind: 'git';
  /**
   * The URI or SSH entry to clone from. (as if by `git clone`)
   */
  repository: string;
  /**
   * The SHA that will be checked out to find default versions for ports from this registry.
   */
  baseline: string;
  /**
   * The ref to fetch when cloning this git registry.
   */
  reference?: string;
}

/**
 * A port registry backed by a filesystem layout.
 */
export interface VcpkgFilesystemRegistry {
  kind: 'filesystem';
  /**
   * The location on the filesystem where the registry is rooted.
   */
  path: string;
  /**
   * The key in the JSON document of baseline.json which will be used for version selection
   */
  baseline?: string;
}

/**
 * An artifact registry backed by a git repository.
 */
export interface VcpkgArtifactRegistry {
  kind: 'artifact';
  name: VcpkgIdentifier;
  /**
   * A URI to the location of the artifact registry; typically a git URI.
   */
  location: string;
}
/**
 * Artifacts that are required for this package to function.
 */
export type VcpkgArtifactReferences = Record<string, string>;
