# riehlegroup/mini-meco format 2 acceptance

Pinned commit `9c6c42bc83c4adf50213d1b8e58ba6afe98c1b75`, independently reconstructed Git tree
`b2c9c2a8ef37fff462e057b77f1f33f4328477d7` over all 189 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `91dd6a318d1edd69bc3593413d4e35bfc659f62677406a03f281b70e39c726d6`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The root lock identifies client and server workspaces and link placements. client/package.json contributes the locked client project; it is not omitted, and does not create an independent declaration graph. server/package-lock.json remains an independent lock observation. Matching current declarations are represented by the locked views; no additional current-manifest graph is claimed.

| Extractor       | Source                     | Nodes | Requests | Roots |
| --------------- | -------------------------- | ----: | -------: | ----: |
| packagelockjson | `package-lock.json`        |   846 |     1752 |    12 |
| packagelockjson | `server/package-lock.json` |   462 |      999 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

No issues were reported.

## Input hashes

| File                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `client/package.json`      | `2f45f45a14f145916eaa7ad7c2df8b0d92b1c9fb8c6b63ff4e8df66ac16bee1e` |
| `package-lock.json`        | `97c5d6e18d920f922d3bcb209f4c1289775f7d1d3b7177153433dd8a394dc4a8` |
| `package.json`             | `d1c1d3ae538191359e70e1d3e1ec804b4a114af806a20419b54281c7da683a65` |
| `server/package-lock.json` | `57ad3f3c6899d8755377735485a4cd2a4b4e48d85ce7f135efab4d282853f87a` |
| `server/package.json`      | `5470adbf03af6e1a1d45e28f6dc8aebd268793e785e6735a163ed097057335da` |

Reviewed baseline `test/__snapshots__/riehlegroup+mini-meco.json` has SHA-256 `eeb99ece2086b4aa2f6143416a684c18aee854245b1231c311baea8a11583ac8`: 884 catalog packages, 3 projects and 2 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
