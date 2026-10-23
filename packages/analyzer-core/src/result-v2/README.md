# Analyzer result v2

This is the sole result model used by library defaults and the CLI. The public
`AnalyzerResult`, `Extractor`, `filesExtractor`, `mergeResults` and `normalizeResult`
names refer directly to the contextual model; explicit V2 aliases name the same API.
No legacy result implementation or compatibility projection remains.
`AnalyzerResultV2` has an independent `formatVersion: 2`; `Extractor.version` describes
the extractor interface, not the serialized result format.

The [wire contract](./WIRE_FORMAT.md) defines portable encoding, validation and
conformance. [Identity provenance](./provenance.md) explains source-scoped coordinate
assertions and their merge behavior.

## Identity and topology

Every package, project and dependency view has a valid, canonical **PURL**. Generic
and versionless PURLs are supported. A native dependency locator, manifest range or
unresolved request is not automatically a resolved package version.

The catalog describes package identities. A graph describes one independent source
observation or resolution. Its nodes are **dependency views**: a PURL together with
the effective outgoing dependencies in that native context. Edges reference graph-local
view IDs. View IDs do not alter PURLs and are not PURL qualifiers.

For example, both views below identify `pkg:npm/widget@1.0.0`:

```text
app dependencies → widget-with-react18 → react@18
app devDependencies → widget-with-react19 → react@19
```

Combining the two widget views by PURL would incorrectly make both React versions
reachable from both scopes. Equal producer variants, artifact hashes or immediate
target PURLs also do not establish equal transitive adjacency.

Retain native view identity where available: npm placement paths, full pnpm snapshot
keys, ORT package/fragment references, resolver node IDs and SBOM document references.
View identity need not represent a physical installation. Cycles are supported; IDs
must not depend on recursively hashing descendants. Graph content hashes identify
observations, rather than defining semantic equivalence between dependency views.

Projects are identified by `(purl, definitionFile)` within `result.codebase`. Two
directories may intentionally declare the same coordinates. A root names one exact
project, native scope and project view. A consumed workspace project uses its consumer
view; it does not introduce that project's development scope roots.

An imported SBOM's analyzed subject can also be a project entry, including a binary
application rather than a source project. Its `definitionFile` names the describing
SBOM input, with a native reference fragment when several subjects need disambiguation.
Native attributes distinguish imported subjects from observed source projects; creating
an analysis root does not claim that source files were inspected.

## Observations and selection

`interpretation` distinguishes `declared`, `locked`, `resolved`, `installed` and
`unknown` observations. None of these alone establishes runtime use or inclusion in
a built artifact. Graph/root context records observed inputs and cannot implicitly
change a shared view's adjacency. Different resolved dependencies require different
views or observations.

Edges preserve the original `requested` declaration separately from its binding:

| Field                    | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `status: resolved`       | A known target view exists. Selection can still be unknown.      |
| `status: declared`       | A source request is recorded without inventing a target.         |
| `status: unresolved`     | Resolution was attempted or expected but no target is known.     |
| `selection: selected`    | The binding or declaration is present in this observation.       |
| `selection: conditional` | Presence depends on the explicit native predicate.               |
| `selection: excluded`    | Explicitly unselected in this observation.                       |
| `selection: unknown`     | Selection is not established, including known lookup candidates. |

`kind` preserves the native relationship role, such as `peerDependencies` or
`tool_requires`. `optional` preserves the native optional property; selected optional
dependencies remain dependencies. `relation: constrains` influences resolution without
introducing ordinary dependency reachability.

Original specifiers, requested features and declaration predicates belong to
`requested`. A pinned snapshot reference is not an original version requirement.
Unreported requests remain absent. Stale manifests and their lockfiles are separate
observations; a newer range must not be falsely bound to an older selected package.

## Conditions and completeness

A condition carries an explicit `language`, native JSON `expression` and optional
`environment` domain. The core does not interpret ecosystem syntax. Unsupported
conditions remain unknown. An evaluator receives the conjunction of conditions along
the complete path, each with its declaring view, plus the explicit query environment.
This supports package-local extras/features and distinct build/target environments
without treating every conditional edge as independently possible.

Keep every platform alternative recorded by a lockfile. The analyzer's host does not
establish the deployment environment. Querying a specified environment may exclude
inapplicable paths without deleting those alternatives from the source observation.

`dependencyCompleteness` describes whether a view's outgoing records were fully
observed. An explicitly known leaf is `complete`; missing adjacency is `unknown`;
observed but incomplete adjacency is `partial`. A fully enumerated declaration list
can be complete even though its resolved closure is unknown.

`rootCompleteness` concerns the entry-point list, not descendant resolution. A catalog
project absent from roots is not thereby dependency-free. Extraction failure retains
an unknown-coverage observation and an issue, rather than a complete empty graph.

`queryDependenciesV2` returns definite and conditional **view IDs**, reachable
declarations and closure completeness for one exact graph/root. PURL-level membership
is a derived projection; it cannot replace the topology. The query does not claim
installed or runtime membership beyond the graph's interpretation.
The query traverses recorded views; it does not run a package manager, solve feature
activation or synthesize the transitive effects of newly requested extras. Those
changes require a native resolved observation or an explicit condition evaluator
with sufficient source data.

### Conservative query contract

`definite` means at least one traversed path was proven applicable. `conditional`
means reachable along a path not proven definite; it does not prove that membership
actually varies between environments. In particular, alternative paths guarded by
`P` and `not P` are not combined into a tautology. An evaluator interprets each
path conjunction, not the disjunction of all paths to a view.

Closure completeness is independent of `rootCompleteness`: an incompletely enumerated
root list can still contain a root whose closure is fully known. For the selected
root, start at `complete`, then combine reachable adjacency using
`complete < partial < unknown`. A reachable unresolved target contributes `partial`;
a declaration without resolution contributes `unknown`. Remaining conditional view
membership contributes `partial`. False paths, excluded edges and constraints do
not contribute. This is conservative: unknown adjacency on a possibly applicable
path still contributes `unknown`.

Predicate sets can create exponentially many traversal states, even in small graphs.
`maxStates` bounds the number of distinct path states processed (default 100,000).
It must be a positive safe integer. Exceeding the budget throws without returning a
closure; callers may explicitly retry with a larger budget. No predicates are dropped
and no truncated result is presented as complete. This is a state budget, not a time
or memory guarantee; graph validation and user-supplied evaluators are separate work.

## Variants, artifacts and extension data

`view.variant` records observed producer/build selection. `enabledFeatures` is the
observed activated set; it differs from `requested.features`. Equal variants never
authorize merging views.

`PackageV2.artifacts` holds package-level artifact observations. `view.artifacts`
holds artifacts explicitly associated with that native view in this observation.
For resolver output this can record selection; for imported SBOMs it records native
component attribution, without establishing resolution or installation. Artifacts
without a known view association stay in the catalog. An artifact descriptor can carry its own qualified
PURL, location and hashes; a component represented separately still needs a PURL.

Use namespaced `attributes` for native facts without a universal interpretation:
`pnpm:snapshot`, Conan package IDs and revisions, Gradle capabilities, vcpkg triplets,
or source linkage. Preserve JSON values and native array order. Attributes must not
silently override normalized identity, selection or reachability semantics.

The following ecosystem mappings are contract design targets. Their existence does
not mean every native adapter has migrated or been validated.

| Ecosystem concern               | Representation                                                              |
| ------------------------------- | --------------------------------------------------------------------------- |
| npm/pnpm peer contexts          | Distinct native views; explicit peer bindings or uncertain candidates       |
| Python markers and local extras | Native predicates with declaring owner; requested versus enabled extras     |
| Cargo feature/target resolution | Requested features, selected features, distinct effective views and domains |
| Maven exclusions/classifiers    | Path-specific views; selected artifact descriptors and native qualifiers    |
| Gradle variants/capabilities    | Selected variant/native attributes; resolver views remain independent       |
| Conan host/build and binary IDs | Native domains/context, dependency roles, selected variant attributes       |
| vcpkg triplets/features         | Native context, activated features and contextual views                     |
| CycloneDX/SPDX references       | Native reference IDs retain distinct views even when PURLs are equal        |

## Merge and validation

`mergeResultsV2` requires a common caller-owned codebase namespace. Supply a stable
`codebaseId` when combining observations; the file helper's default only identifies
the local analysis directory. Independent graphs keep their namespaces and topology.
The same graph ID with different content is an explicit conflict. Catalog metadata
conflicts are reported; adjacency is never unioned by PURL.

Validation checks canonical PURLs, exact project/catalog references, graph-local
IDs and edge selection/status consistency. Normalization sorts set-like arrays and
preserves arbitrary JSON metadata, including native keys named `constructor` or
`__proto__`. It does not reconstruct a reduced object that silently drops fields.

## Design alternatives

| Alternative                                            | Assessment                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| PURL adjacency plus edge annotations                   | Cannot distinguish two outgoing contexts of one package.                                     |
| Separate PURL graph per project/scope                  | Context differences can coexist inside one scope.                                            |
| Producer variant as node identity                      | Equal producer/artifact selection can have different closures.                               |
| PURL-keyed maps of dependency views                    | Equivalent when references retain full view IDs; flat records are canonical.                 |
| Globally shared graph fragments                        | Sound compression option, but adds equivalence/provenance requirements.                      |
| Global requirement/binding/variant/artifact registries | Optional future normalization; unnecessary for correct topology.                             |
| CycloneDX or SPDX as canonical internal format         | Useful interchange formats; native scope and resolution semantics still need representation. |

The stable boundary is the separation of identity, observation, effective view,
declaration, selection and artifact provenance. Native metadata extends these concepts
without adding a new public entity for each package manager. A semantic change that
cannot be represented faithfully still requires an explicit format revision.

## Migration and acceptance

Native adapters exist for ORT, npm package locks, pnpm locks,
manifest-only npm projects, Yarn Classic/modern, text Bun locks, Deno locks, Cargo
lock records and Cargo metadata package-resolution/declaration imports,
CycloneDX and SPDX 3 compact JSON/JSON-LD/YAML.

Yarn's raw merged workspace dependency records and current manifest scope
correlations are independent observations. Both explicitly identify their projection
as `raw-descriptor-map`, with effective resolution unobserved and resolver transforms
unapplied. Yarn can apply built-in compatibility patches, overrides and plugin
transforms before binding dependencies; a direct lock descriptor lookup is not that
effective resolver result. Its lockfile does not report virtual peer
instances, so peers remain declarations rather than invented resolved bindings.
Bun retains native package placement paths, workspace alias contexts and explicit
unresolved markers. Deno retains opaque peer-context IDs and separates native locked
workspace entry points from current import-map declarations. Its JSR adjacency is
conservatively unknown: lock retention records do not establish a complete published
dependency list. Binary Bun locks and arbitrary external Deno import maps are not
silently presented as complete observations.

Cargo metadata retains opaque IDs and exact workspace membership. Its aggregate
`cargo:metadata` roots describe package-graph membership, including reported member
development dependencies; current manifest declaration scopes are a separate graph.
Package-level feature sets do not establish separate host/target compilation variants.
Target predicates remain attached to native requests without treating every emitted
predicate as active after platform filtering. Compilation-unit and runtime closures
require stronger native evidence. A lock-only Cargo observation cannot reconstruct
those scopes, activated features or workspace paths; legacy `[root]` is preserved as
an explicitly imported subject.

The SPDX importer does not expand arbitrary JSON-LD contexts or accept general RDF.
Native lifecycle and time predicates remain conditional without an evaluator; conditional
completeness claims stay conservatively unknown. `NoneElement` records known absence
of a relationship kind; `NoAssertionElement` records unknown coverage and never becomes
a fabricated component or dependency request.

The CLI writes format 2 and retains extractor failures as unknown-coverage observations.
Native V2 adapters also exist for Go modules, Maven trees, Gradle configuration snapshots,
Python requirements/pyproject/Pipfile/Poetry/PDM, UV exports, Dockerfiles, GitHub Actions,
Conan and vcpkg. These preserve the capabilities of the existing extractors; no new
ecosystems or package managers are introduced. The integration harness requires reviewed format 2 baselines. Legacy integration
baselines are retained only as migration references and fail that acceptance gate
until independently reviewed against their pinned source inputs. Do not project
a legacy PURL union into V2 and present it as a precise native graph.

Go observations distinguish selected build-list membership from original module requests;
module graph pruning leaves selected adjacency unknown. Maven retains native dependency-tree
occurrences so exclusions and mediation do not collapse equal-coordinate contexts; scope
roots describe tree groups, not inferred runtime classpaths. Gradle retains configuration-local
component snapshots with unknown variant and unresolved-dependency coverage. These snapshots
do not establish effective variant graph equivalence. Converter fixtures test these modeled
cases; they do not replace end-to-end native resolver acceptance.

Contract tests cover repeated PURLs, exact project ownership, peer contexts, consumed
projects, exclusions, cycles, path predicates, environment domains, constraints,
unresolved declarations, artifact selection, unknown leaves, merge conflicts and
JSON metadata preservation. Native adapter tests supplement these semantics.

Fixtures and snapshots are regression inputs, not correctness oracles. They may
contain stale manifests, malformed locks or previously incorrect expected results.
Acceptance evidence must distinguish schema validation, successful extraction,
independent raw-source comparisons and comparisons with native resolver output.
Neither a passing snapshot nor a valid result proves that its dependency edges are
correct. Record the exact upstream revision and input hashes, including prepared
manifest changes, and report unresolved differences rather than updating snapshots
to conceal them.

The pinned Porsche comparison retains the existing ORT input and prepared manifests.
The ORT adapter matches every one of its 29 reported native scope closures; 16
unreported scopes remain unknown. The npm adapter independently matches all 696
direct declarations across 48 projects, preserves 17 optional peers and all platform
alternatives, and covers all 439 PURLs in the raw ORT package catalog. ORT and npm
scope names and resolution contexts are not assumed equivalent.

Additional native checks establish narrower, explicit claims:

| Input                                                 | Evidence                                                                                                                                                  | Limit                                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algolia at `32012722f64452e961ce1e2fecb24620e168b7a3` | Verified pinned Yarn 4.10.3 executable; 940 raw records and 1,819 requests compared independently; 1,741 ordinary native bindings compared                | 26 built-in compatibility patch rewrites remain differences; virtual target locators were projected for comparison, so effective graph equivalence is not claimed |
| Cargo 1.90.0 controlled workspace                     | Four native metadata modes, 33 dependency-kind tuples and 21 aggregate package-graph closures compared; seven `--no-deps` roots retain unknown resolution | Controlled inputs supplement independent real repositories; metadata does not establish compilation-unit variants                                                 |
| ripgrep at `0a88cccd5188074de96f54a4b6b44a63971ac157` | Thirteen Cargo inputs checked against upstream blobs; ten native workspace projects, 73 declarations and 170 raw bindings across two lock graphs compared | `--no-deps` metadata leaves resolved closure unknown; lock records cannot supply target or feature activation                                                     |

The Cargo regression capture includes native tool provenance and unchanged metadata
output alongside its source inputs. These checks supplement the contract tests; they
do not make fixtures or snapshots authoritative for untested behavior.

Source-backed migration of the retained integration baselines and cross-ecosystem
native integration checks must finish before freezing the contract.
