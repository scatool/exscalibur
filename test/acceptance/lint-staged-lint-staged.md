# lint-staged/lint-staged format 2 acceptance

Pinned commit `a1ec97295c6163acb2e8fe1adeae9fbe14de16a2`, independently reconstructed Git tree
`561b8993844d93a643b7ec5e73c6a3999684e059` over all 158 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `e8711c9c9a5d2b8def68aae014b633c669519eea02dee31f543c2e0da40d7dce`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

`test/unit/__mocks__/my-lint-staged-config/package.json` is a nested fixture, not a lock workspace. Ancestor-lock discovery suppresses its standalone extraction. Its declarations are not asserted as extracted.

| Extractor       | Source              | Nodes | Requests | Roots |
| --------------- | ------------------- | ----: | -------: | ----: |
| packagelockjson | `package-lock.json` |   460 |      726 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

No issues were reported.

## Input hashes

| File                                                     | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `package-lock.json`                                      | `97905cbc84391f85f5a477f224a4dd39ed021512a0c268689b8bb33c644de3a4` |
| `package.json`                                           | `4fd99972a541e79c6d713ee6cb9c3f69256c62a78f30fe5f3b9d8ee7c1eb4f9d` |
| `test/unit/__mocks__/my-lint-staged-config/package.json` | `0c6220a4449d97e1e96e8576099ba9e2b8e154a5be262092e1fe25f44775fcf6` |

Reviewed baseline `test/__snapshots__/lint-staged+lint-staged.json` has SHA-256 `4e5c9c2fe5d50710c0cd3cde8d377c40641dae7f296e409ad63a1bed0db74d19`: 431 catalog packages, 1 projects and 1 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
