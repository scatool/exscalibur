# sindresorhus/got format 2 acceptance

Pinned commit `f9faa7a40599001636c3ae2a68e875e3419e5084`, independently reconstructed Git tree
`919456a4776ecc792c19b063968e99eb2cb1e781` over all 117 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `7f8146572f85db5fcefcb3e57680a86998a6b17f30e178315dd8ba5f899b9dbb`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

Only a manifest is present. All four scope roots and 56 requests are preserved as declarations without invented package identities or bindings. Resolved closure is empty and completeness remains unknown where declarations exist.

| Extractor   | Source         | Nodes | Requests | Roots |
| ----------- | -------------- | ----: | -------: | ----: |
| packagejson | `package.json` |     5 |       56 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

No issues were reported.

## Input hashes

| File           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `package.json` | `66487f9b11a7807ed30b1bfaa21ce3e36ef66527056d8d15a31b27e4c00148fd` |

Reviewed baseline `test/__snapshots__/sindresorhus+got.json` has SHA-256 `49170bb2c4ab60d1580ae224c488775833a93003086ffdc4752a5fce4b7edf18`: 0 catalog packages, 1 projects and 1 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
