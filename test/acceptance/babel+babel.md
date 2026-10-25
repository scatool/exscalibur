# babel/babel native format 2 acceptance

Pinned commit `4cc3d8888f3e3ac30d38ccfa4557baa7a4a52714`, Git tree `ec7d26d9baa6f42d03a5570ff35949d1562590e8`, source archive SHA-256 `1e8f32b0826800ca8fdc5bba945a71184090671e8757d4948b2b1ff555e8f044`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 224 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

Existing discovery excludes 50 nested manifests: 46 unnamed fixture manifest, 2 malformed fixture, 2 named nonworkspace manifest. Each excluded path is listed and hashed in the inventory. Ancestor lockfile discovery selects its native workspace/importer projects and suppresses standalone descendants. These exclusions preserve existing behavior; this acceptance does not claim dependency coverage for those manifests. Malformed unselected fixtures do not produce invented parsing failures.

All 16 configured integration extractors ran with namespace `integration:babel/babel@4cc3d8888f3e3ac30d38ccfa4557baa7a4a52714` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 3 graphs, 173 projects, 1600 catalog identities and 12482 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: 18 npm.unresolved_dependency, 2 yarn.manifest_lock_mismatch, 1 yarn.raw_lock_projection. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.

## Yarn binding certainty correction

The previous raw descriptor projection could label an unproven effective binding
as selected. Current root resolution policies and known built-in compatibility
patch descriptors now constrain that certainty. This correction preserves the raw
targets and requests instead of claiming to execute Yarn's resolver.

Across the two affected observations, 95 edge records gain explicit
uncertainty evidence (52 root-policy and
43 compatibility-patch records); 95 selections change to unknown.
90 source-node coverage/evidence records change. Source-node coverage remains
unknown even if another selected path reaches the same raw target, because its
effective outgoing dependency closure has not been established.

The inspected root selectors are:

- `@babel/parser/@babel/types`
- `@babel/plugin-syntax-unicode-sets-regex/@babel/helper-create-regexp-features-plugin`
- `@types/babel__core`
- `babel-plugin-polyfill-corejs2/@babel/compat-data`
- `browserslist`
- `caniuse-lite`
- `core-js-compat`
- `electron-to-chromium`

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

The `@babel/parser/@babel/types` rule demonstrates why raw parser-to-registry-types
bindings cannot be selected effective dependencies. The independent path through
`@babel/preset-modules@0.1.6-no-external-plugins` remains selected, so types 7.27.6 can legitimately
remain definite through that path. Its presence does not repair the parser binding
or establish complete closure. A permanent acceptance assertion checks both facts.

The full sixteen-extractor capture preserves catalog, projects, roots, raw
bindings/requests/native records, optional/platform conditions, issues and source
hashes. Only targeted uncertainty, supporting evidence, source-node coverage and
content-derived graph IDs change. Permanent acceptance assertions check each
reported uncertainty against its native selector or compatibility descriptor,
alongside the existing raw-fact comparisons and unaffected-selection assertions.

Previous accepted format 2 SHA-256:
`fe2c7a579d9114a441b64806b37b8e15496993cf817ff86b8bcfd36c9eaa0b1c`.
Corrected baseline SHA-256:
`543d30894524d4fdc86171d7d84a4bd431d458b6a04f6f06793d31b2ff6e42f3`.
The historical format 1 hash and input pins in the acceptance ledger are unchanged.
