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
