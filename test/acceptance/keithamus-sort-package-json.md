# keithamus/sort-package-json format 2 acceptance

Pinned commit `a03895650fb6fe155af6c2c03491de9bc492fdab`, independently reconstructed Git tree
`26e78b87a851b35d7f1ee4081235c0e9750cc737` over all 43 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `e4ae782cedba501670e061a83f5484a27bcad9ecd1dee0606ed2b18a01f932a7`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The current devDependencies differ from the root lock table. A WARNING and independent current-manifest declaration graph preserve that difference instead of overwriting locked requests.

| Extractor       | Source              | Nodes | Requests | Roots |
| --------------- | ------------------- | ----: | -------: | ----: |
| packagejson     | `package.json`      |     5 |       25 |     4 |
| packagelockjson | `package-lock.json` |   905 |     1444 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

- `npm.manifest_lock_mismatch` WARNING at `package.json`: The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations

## Input hashes

| File                | SHA-256                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `package-lock.json` | `79c42cea13ae3fa50a54de880ec69be9440e0564cdd60843f43fea79eefebcfb` |
| `package.json`      | `fd48a54a991a5207fdafa2a61e55930e0389253dd0cac9d940059601da44defa` |

Reviewed baseline `test/__snapshots__/keithamus+sort-package-json.json` has SHA-256 `7db4b1bc4815239f33eb2615851c23a77af65faa4d01a5e9b346d43b8ada6e1b`: 716 catalog packages, 1 projects and 2 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
