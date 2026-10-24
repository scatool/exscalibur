# sindresorhus/execa format 2 acceptance

Pinned commit `23ec6f0569b3e42af43294dc807494ebe896e980`, independently reconstructed Git tree
`525e090234773547838e06140812cade695ea3b1` over all 624 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `c55571f11f6d123759885d04dab1781bd05d98bfdb2e168a88e42d1ce235ebfd`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

Only a manifest is present. All four scope roots and 26 requests are preserved as declarations without invented package identities or bindings. Resolved closure is empty and completeness remains unknown where declarations exist.

| Extractor   | Source         | Nodes | Requests | Roots |
| ----------- | -------------- | ----: | -------: | ----: |
| packagejson | `package.json` |     5 |       26 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

No issues were reported.

## Input hashes

| File           | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `package.json` | `c64fd2752fc343fec7521a01db4d58b7de1dbda100e1c7168fdc03f0b1420061` |

Reviewed baseline `test/__snapshots__/sindresorhus+execa.json` has SHA-256 `9e8d7d944a289ce1a205fbb03d95c448126edd7c9d68643b2e37d551cfee74f6`: 0 catalog packages, 1 projects and 1 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
