# algolia/algoliasearch-client-javascript native format 2 acceptance

Pinned commit `32012722f64452e961ce1e2fecb24620e168b7a3`, Git tree `a4dea101c3340083395e70d161f6b900b1526fd9`, source archive SHA-256 `ae14e75130c6b15c0310933457289ed482333006247b585da51f19b5d522118f`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 21 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

All 16 configured integration extractors ran with namespace `integration:algolia/algoliasearch-client-javascript@32012722f64452e961ce1e2fecb24620e168b7a3` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 3 graphs, 20 projects, 916 catalog identities and 4247 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: 1 yarn.raw_lock_projection. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.

## Yarn binding certainty correction

The previous raw descriptor projection could label an unproven effective binding
as selected. Current root resolution policies and known built-in compatibility
patch descriptors now constrain that certainty. This correction preserves the raw
targets and requests instead of claiming to execute Yarn's resolver.

Across the two affected observations, 72 edge records gain explicit
uncertainty evidence (0 root-policy and
72 compatibility-patch records); 72 selections change to unknown.
72 source-node coverage/evidence records change. Source-node coverage remains
unknown even if another selected path reaches the same raw target, because its
effective outgoing dependency closure has not been established.

The inspected root selectors are:

No root-resolution selector contributes to this correction.

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

Native Yarn 4.10.3 preparation of the pinned TypeScript request independently
selects its compatibility-patched descriptor. The lock retains the unpatched
descriptor too; that raw candidate now remains uncertain rather than definite.
The extractor does not execute the preparation hook or claim an installed tree.

The full sixteen-extractor capture preserves catalog, projects, roots, raw
bindings/requests/native records, optional/platform conditions, issues and source
hashes. Only targeted uncertainty, supporting evidence, source-node coverage and
content-derived graph IDs change. Permanent acceptance assertions check each
reported uncertainty against its native selector or compatibility descriptor,
alongside the existing raw-fact comparisons and unaffected-selection assertions.

Previous accepted format 2 SHA-256:
`237576d56174accac39f4feba51a8d9d1103297e036812f933fc14cdddcad168`.
Corrected baseline SHA-256:
`1a90e92238f2ee566acd50aff5e6bbdfe5d363c3f598c1f089839a4c29abc24e`.
The historical format 1 hash and input pins in the acceptance ledger are unchanged.
