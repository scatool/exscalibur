# Identity provenance

A catalog PURL identifies a package, not the process that assigned its coordinates.
A source can supply that PURL natively while another source independently synthesizes
the same string. Therefore `synthesizedPurl` is not a catalog or project scalar.

Optional `identityObservations` on packages and projects preserves assertions as
records containing `source: { extractor, files, key? }` and a required boolean
`synthesizedPurl`. Source files belong to the result's codebase namespace. Use a
native entity or observation key to distinguish separate records from the same input.
The source need not name a graph: a catalog-only import can establish identity
provenance without establishing any dependency topology.

`true` records a fallback identity; `false` explicitly records native coordinates.
An absent array or an empty array contains no assertions, and must not be read as
`false`. Absence and an explicitly empty array remain distinct serialized states.
Each assertion owns its source files; the package's unioned evidence cannot transfer
one assertion to another source. File extraction rebases these source paths along
with other evidence paths.

Merge preserves the union of complete assertion records, normalizing source file
sets and removing exact duplicates. It does not select a winning boolean. Even
contradictory records from the same named source are preserved as conflicting source
assertions; neither is an intrinsic catalog fact. Consumers needing a single answer
must resolve that disagreement explicitly. The core does not invent a source
registry or equate source descriptions with dependency graph identity.

Package and project `attributes` remain compatible intrinsic catalog metadata: merge
rejects conflicting values. Observation-dependent metadata belongs on graphs, views,
or an explicitly source-scoped assertion. The removed unscoped `synthesizedPurl`
field is rejected rather than silently accepted as extension metadata.
