import type { ExternalReference, Issue } from "../types.ts";

/** JSON values only: results must survive serialization without losing native information. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** Completeness concerns this observation and context, never every possible deployment. */
export type Completeness = "complete" | "partial" | "unknown";

/** An observed artifact, kept independently of package identity and graph topology. */
export type Artifact = {
  /** Optional coordinates of this artifact descriptor; component/project PURLs remain required. */
  purl?: string;
  location?: string;
  hashes?: Record<string, string>;
  evidence: string[];
  attributes?: JsonObject;
};

/** An assertion about how one source assigned coordinates, not an intrinsic identity fact. */
export type IdentityObservation = {
  source: {
    extractor: string;
    files: string[];
    /** Native entity or observation key when needed to distinguish assertions from one input. */
    key?: string;
  };
  /** False explicitly reports native coordinates; absence of an observation makes no assertion. */
  synthesizedPurl: boolean;
};

/** Catalog identity. Generic and versionless PURLs are valid; a PURL is always required. */
export type Package = {
  purl: string;
  evidence: string[];
  identityObservations?: IdentityObservation[];
  /** Package-level observations, not a claim that every view represents every artifact. */
  artifacts?: Artifact[];
  externalReferences?: ExternalReference[];
  attributes?: JsonObject;
};

/** A PURL alone need not distinguish analyzed projects/subjects declaring identical coordinates. */
export type ProjectReference = {
  purl: string;
  definitionFile: string;
};

/** A source project or imported analyzed subject; definitionFile names its describing input. */
export type Subproject = ProjectReference & {
  evidence?: string[];
  identityObservations?: IdentityObservation[];
  attributes?: JsonObject;
};

/** Producer/build selection. Equal variants do not imply equal dependency views. */
export type SelectedVariant = {
  name?: string;
  attributes?: JsonObject;
  /** Absent means unknown; [] means explicitly no enabled features. */
  enabledFeatures?: string[];
};

/** A native predicate; the core never guesses its language or treats unsupported syntax as false. */
export type DependencyCondition = {
  language: string;
  expression: JsonValue;
  /** Native environment domain, e.g. build versus target; absent means the default domain. */
  environment?: string;
};

/** The original request is not a claim about a selected or installed package version. */
export type DependencyRequest = {
  /** Source declaration identity, shared across alternative resolutions when available. */
  id?: string;
  name?: string;
  specifier?: string;
  purl?: string;
  features?: string[];
  /** Original declaration predicate, including when a resolver has already selected its binding. */
  condition?: DependencyCondition;
  attributes?: JsonObject;
};

/** One effective dependency context; it need not correspond to one physical installation. */
export type DependencyView = {
  /** Opaque, unique within this graph. Preserve native locators; never recursively hash descendants. */
  id: string;
  purl: string;
  /** Set for an analyzed project/subject, including its consumer-facing views. */
  project?: ProjectReference;
  locator?: string;
  /** Whether outgoing dependency records were fully observed, including unresolved declarations. */
  dependencyCompleteness: Completeness;
  variant?: SelectedVariant;
  /** Artifacts explicitly associated with this native view in this observation; not proof of installation. */
  artifacts?: Artifact[];
  evidence?: string[];
  attributes?: JsonObject;
};

type DependencySelection =
  | { selection: "selected" | "excluded"; condition?: never }
  | { selection: "conditional"; condition: DependencyCondition }
  | { selection: "unknown"; condition?: DependencyCondition };

type DependencySemantics = DependencySelection & {
  from: string;
  /** Constraints influence resolution but do not introduce ordinary dependency reachability. */
  relation: "depends-on" | "constrains";
  /** Native dependency kind, e.g. peerDependencies or tool_requires; not a universal usage taxonomy. */
  kind?: string;
  /** Preserve the ecosystem's optional property; this does not mean unselected or unused. */
  optional?: boolean;
  requested?: DependencyRequest;
  /**
   * selected: binding is present in the recorded graph context.
   * conditional: presence depends on condition in the queried environment.
   * excluded: explicitly not selected in this observation.
   * unknown: selection is not established, even if a candidate target is known.
   * For declarations, selection concerns the requirement, not an installed target.
   */
  evidence?: string[];
  attributes?: JsonObject;
};

export type ResolvedDependency = DependencySemantics & {
  status: "resolved";
  to: string;
};

/** A declaration has no invented target view or fabricated resolved version. */
export type UnresolvedDependency = DependencySemantics & {
  status: "declared" | "unresolved";
  requested: DependencyRequest;
  to?: never;
};

export type DependencyEdge = ResolvedDependency | UnresolvedDependency;

/** Scopes belong to exact analyzed projects/subjects. A root node represents that scope's view. */
export type DependencyRoot = {
  id: string;
  project: ProjectReference;
  scope: string;
  node: string;
  /** Observed inputs only; this cannot implicitly change the adjacency of shared views. */
  context?: JsonObject;
  evidence?: string[];
};

/** One independent source observation/resolution. Native IDs are local to this graph. */
export type DependencyGraph = {
  /** Observation identity within one codebase. Equal IDs with different contents are a conflict. */
  id: string;
  source: {
    extractor: string;
    files: string[];
    /** Native observation key, e.g. a resolver configuration or imported graph name. */
    key?: string;
    tool?: { name: string; version?: string };
  };
  /** Importing a graph does not establish how its dependencies were originally selected. */
  interpretation: "declared" | "locked" | "resolved" | "installed" | "unknown";
  /** Known resolution inputs, not an assumption about where the software will be deployed. */
  context?: JsonObject;
  /**
   * Whether this observation enumerated its entry points completely. A catalog project absent
   * from its roots is not thereby dependency-free; catalog membership does not establish scope coverage.
   */
  rootCompleteness: Completeness;
  roots: DependencyRoot[];
  nodes: DependencyView[];
  edges: DependencyEdge[];
  attributes?: JsonObject;
};

/**
 * Canonical topology lives exclusively in graphs. Package PURLs identify catalog entries;
 * roots and edges identify graph-local views. The extractor-interface version is independent.
 * Additive JSON metadata must not redefine identity, selection or reachability. New applicability
 * semantics belong in conditional edges with an explicit predicate language; unsupported languages
 * remain unknown to a consumer, rather than silently becoming unconditional dependencies.
 */
export type AnalyzerResult = {
  formatVersion: 2;
  /**
   * Caller-owned codebase namespace. Project references and paths belong to this namespace.
   * Results from different namespaces cannot be implicitly reconciled by mergeResults().
   */
  codebase: string;
  packages: Package[];
  subprojects: Subproject[];
  graphs: DependencyGraph[];
  issues: Issue[];
};

export type ConditionTruth = "true" | "false" | "unknown";

export type PathCondition = {
  condition: DependencyCondition;
  /** Declaring view: local extras/features are not one global variable shared by all packages. */
  owner: string;
};

/**
 * Evaluate the conjunction of all path predicates in one environment. Evaluating individual
 * edges as independently possible would incorrectly admit mutually incompatible paths.
 */
export type ConditionEvaluator = (input: {
  conditions: readonly PathCondition[];
  context: Readonly<JsonObject>;
  graph: Readonly<DependencyGraph>;
  root: Readonly<DependencyRoot>;
}) => ConditionTruth;

export type ReachableDeclaration = {
  dependency: UnresolvedDependency;
  applicability: "definite" | "conditional";
  /** Native path predicates and their declaring views, including this declaration's predicate. */
  conditions: PathCondition[];
};

export type DependencyClosure = {
  graph: string;
  root: string;
  interpretation: DependencyGraph["interpretation"];
  /** Graph-local node IDs, excluding the starting root. Not a claim of runtime usage. */
  definite: string[];
  /** Reachable on a path not proven definite; alternative paths are not combined into tautologies. */
  conditional: string[];
  declarations: ReachableDeclaration[];
  /**
   * Completeness for this exact root, independent of root enumeration. Unknown dominates partial,
   * which dominates complete; unresolved targets and unproven membership can lower completeness.
   */
  completeness: Completeness;
};
