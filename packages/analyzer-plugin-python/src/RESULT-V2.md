# Native Python result observations

The five existing Python extractors expose matching `*ExtractorV2` entry points.
Requirements and pyproject inputs report declarations, including original specifiers,
requested extras, native predicates and source references. A pinned requirement is
still a declaration, not evidence that a resolver selected or installed it. Dynamic
metadata and unexpanded requirement/constraint includes preserve unknown coverage.

Poetry and PDM locks retain one view per native package record, including repeated
names and versions. Their `locked-group:*` roots describe recorded group membership;
`locked-packages` describes the retained catalog when membership was unreported.
These imported subjects are identified by the lock input, not fabricated project
versions. Root enumeration remains unknown for application dependency scopes.
Current pyproject declarations form a separate observation even when a lock exists.
A malformed companion manifest does not discard successfully read lock data.

A unique lock candidate is a known target, but a range alone does not prove its
selection: range-based candidates retain unknown selection. Exact equality,
wildcard and bare-name requests may establish selection when only one record
matches. Multiple native candidates remain unresolved with their candidate view IDs
preserved as metadata. Explicit source requests are not bound to registry packages
by name. Native marker, optional-extra and Python-version applicability remains
conditional; the core does not solve Poetry or PDM predicates.

Pipfile lock categories retain distinct views and versions. They do not report
package adjacency, so package dependency completeness remains unknown. Unversioned
path/VCS entries remain declarations. All native records and lock metadata are
retained rather than reduced to PURL adjacency.

UV retains its existing native frozen CycloneDX export path through the V2 importer.
The export records UV provenance without claiming installation or reconstructing
project roots omitted by `--no-emit-project`. Export errors retain an error issue
and an unknown-coverage observation.
