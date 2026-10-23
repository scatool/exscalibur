# terser/html-minifier-terser format 2 acceptance

Pinned commit `c4a7ae0bd08b1a438d9ca12a229b4cbe93fc016a`, independently reconstructed Git tree
`8f445e32b6a665f464d3392c407c36bbf101602e` over all 39 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `48438b95cab35bf62ec372dcdbe8d6e27a1f5278a3badcf7f6bf7e448da605d4`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The root and benchmarks locks are independent observations. Both manifests are accounted for by their lock projects, without merging project scopes across locks.

| Extractor       | Source                         | Nodes | Requests | Roots |
| --------------- | ------------------------------ | ----: | -------: | ----: |
| packagelockjson | `benchmarks/package-lock.json` |    69 |       91 |     4 |
| packagelockjson | `package-lock.json`            |   711 |     1409 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

No issues were reported.

## Input hashes

| File                           | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `benchmarks/package-lock.json` | `dc6b34924f205cfc48740a9bf157a2164f14679e3dcb7cdcabf6ce986084cae4` |
| `benchmarks/package.json`      | `97996c1781889ffa696f61c743dd7aaa3cc0857d709fd5c287b5c9aa3a207bc0` |
| `package-lock.json`            | `72a1360238384bfab323c1dc66c1c9affd2c75e0e66a8f0a2d0651dd5f91142f` |
| `package.json`                 | `9f88f1e3cfcf1f9dfcc0a519c1f71e497a89197e60b22004357c661bd77757d5` |

Reviewed baseline `test/__snapshots__/terser+html-minifier-terser.json` has SHA-256 `6bc72e4b66fc96a037b373de1c8a7c51fa87ac37513412a44d78c2a2129e8282`: 715 catalog packages, 2 projects and 2 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
