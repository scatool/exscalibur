# emotion-js/emotion native format 2 acceptance

Pinned commit `14a61e4c42dcaa685520992d815ec8cf6351b80b`, Git tree `4d0ccc06a1e693d91813c51bc371ebabbf5697f2`, source archive SHA-256 `f0029e22d6528a26be0a41c2d539d7e235e4a60d32adc4f86c999a5e2ac1b01a`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 42 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

Existing discovery excludes 9 nested manifests: 9 unnamed fixture manifest. Each excluded path is listed and hashed in the inventory. Ancestor lockfile discovery selects its native workspace/importer projects and suppresses standalone descendants. These exclusions preserve existing behavior; this acceptance does not claim dependency coverage for those manifests. Malformed unselected fixtures do not produce invented parsing failures.

All 16 configured integration extractors ran with namespace `integration:emotion-js/emotion@14a61e4c42dcaa685520992d815ec8cf6351b80b` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 3 graphs, 32 projects, 3084 catalog identities and 16504 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: 1 yarn.raw_lock_projection. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.

## Yarn binding certainty correction

The previous raw descriptor projection could label an unproven effective binding
as selected. Current root resolution policies and known built-in compatibility
patch descriptors now constrain that certainty. This correction preserves the raw
targets and requests instead of claiming to execute Yarn's resolver.

Across the two affected observations, 150 edge records gain explicit
uncertainty evidence (42 root-policy and
108 compatibility-patch records); 150 selections change to unknown.
106 source-node coverage/evidence records change. Source-node coverage remains
unknown even if another selected path reaches the same raw target, because its
effective outgoing dependency closure has not been established.

The inspected root selectors are:

- `@definitelytyped/dtslint@0.0.112`

Compatibility evidence is limited to same-identity wrapped descriptors with the
known `optional!builtin<compat/name>` or older `~builtin<compat/name>` forms.
Unrelated manual patches and alias wrappers do not taint ordinary bindings.
Native Yarn 4.10.3 preparation independently verifies representative overrides
and compatibility rewrites; the older Berry hooks were inspected for their
legacy marker and literal-comparison behavior. Normalized policy matching is
conservative for older Berry, not proof every policy was applied. Classic Yarn
ancestor paths are absent from lock records, so target-name policy matches remain
uncertain rather than inventing an issuer path. No installation or full effective
resolution is asserted.

The full sixteen-extractor capture preserves catalog, projects, roots, raw
bindings/requests/native records, optional/platform conditions, issues and source
hashes. Only targeted uncertainty, supporting evidence, source-node coverage and
content-derived graph IDs change. Permanent acceptance assertions check each
reported uncertainty against its native selector or compatibility descriptor,
alongside the existing raw-fact comparisons and unaffected-selection assertions.

Previous accepted format 2 SHA-256:
`0d982d9b5198d113343e2d0f93b289219d5927e5b60c8539c31dc1f6a7094c18`.
Corrected baseline SHA-256:
`f17fa313b79da611a5d3c25713f9937027da0250bd9e89ab04c0772557996b27`.
The historical format 1 hash and input pins in the acceptance ledger are unchanged.
