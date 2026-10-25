# svg/svgo format 2 acceptance

Pinned commit `9d9afa35bb1eadd09302ddafdc7a28683bfa67c7`, independently reconstructed Git tree
`44ba78ac68bbaf3543d52f2228b98c48a90c7d29` over all 589 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `3273a57880345a63494b10e3bcbd8102e1be75e7c1f469ce2c646b83356d8dbc`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The Berry lock records package.json workspace requests, including sax ^1.4.1, for which the lock has no matching descriptor. That edge remains unresolved with npm.unresolved_dependency WARNING; no successful empty resolution is substituted. Both raw native and scoped projections are retained. The separate declared graph preserves current requests.

| Extractor   | Source         | Nodes | Requests | Roots |
| ----------- | -------------- | ----: | -------: | ----: |
| packagejson | `package.json` |     5 |       32 |     4 |
| yarnberry   | `yarn.lock`    |   555 |     1071 |     4 |
| yarnberry   | `yarn.lock`    |   552 |     1071 |     1 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

- `npm.unresolved_dependency` WARNING at `package.json`: Could not resolve 'sax' (^1.4.1) from its native lockfile yarn:dependencies
- `yarn.raw_lock_projection` HINT at `yarn.lock`: Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed

## Input hashes

| File           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `package.json` | `414395e465dabf381680e202d5e97c9d06915340b114ee48cc7927a49d82a8aa` |
| `yarn.lock`    | `aaafb6ac1c48d02fe3b2948796a2ae1e411242f813a8a259984038ee7ca8b2a0` |

Reviewed baseline `test/__snapshots__/svg+svgo.json` has SHA-256 `7a39d327947a2d1bd2ac70bf49a7407846f5c03dbeef5164d357bc0ce0b4171e`: 545 catalog packages, 1 projects and 3 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.

## Yarn binding certainty correction

The previous raw descriptor projection could label an unproven effective binding
as selected. Current root resolution policies and known built-in compatibility
patch descriptors now constrain that certainty. This correction preserves the raw
targets and requests instead of claiming to execute Yarn's resolver.

Across the two affected observations, 19 edge records gain explicit
uncertainty evidence (4 root-policy and
15 compatibility-patch records); 19 selections change to unknown.
17 source-node coverage/evidence records change. Source-node coverage remains
unknown even if another selected path reaches the same raw target, because its
effective outgoing dependency closure has not been established.

The inspected root selectors are:

- `sax@^1.4.1`

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
`7a39d327947a2d1bd2ac70bf49a7407846f5c03dbeef5164d357bc0ce0b4171e`.
Corrected baseline SHA-256:
`c7c8c6d7f1fb48841beb74b8cc33c718e63c9a2c4462d06752835565495505c1`.
The historical format 1 hash and input pins in the acceptance ledger are unchanged.
