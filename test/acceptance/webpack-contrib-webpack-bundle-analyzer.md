# webpack-contrib/webpack-bundle-analyzer format 2 acceptance

Pinned commit `8755634841119cedd3efa315a2224d13b6ef51f5`, independently reconstructed Git tree
`18c5c8967a569db433e2f6af125e7d245ae91916` over all 194 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `be4dea405f51c97b62ae89c7ecd6950c32d323e88503382c91b1a81c8b70c5fe`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The root lock and both test/webpack-versions locks are independent observations. Each nested version fixture also has a current declaration graph and manifest-lock mismatch WARNING; the root lock remains separate.

| Extractor       | Source                                           | Nodes | Requests | Roots |
| --------------- | ------------------------------------------------ | ----: | -------: | ----: |
| packagelockjson | `package-lock.json`                              |  1398 |     2860 |     4 |
| packagejson     | `test/webpack-versions/4.44.2/package.json`      |     5 |        1 |     4 |
| packagelockjson | `test/webpack-versions/4.44.2/package-lock.json` |   355 |      605 |     4 |
| packagejson     | `test/webpack-versions/5.76.0/package.json`      |     5 |        1 |     4 |
| packagelockjson | `test/webpack-versions/5.76.0/package-lock.json` |    82 |      116 |     4 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

- `npm.manifest_lock_mismatch` WARNING at `test/webpack-versions/4.44.2/package.json`: The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations
- `npm.manifest_lock_mismatch` WARNING at `test/webpack-versions/5.76.0/package.json`: The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations

## Input hashes

| File                                             | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `package-lock.json`                              | `6dc9532b414baa0ad0b58ec203e6cdabf78b7e0ad50b79fe68c946b8b18c3db6` |
| `package.json`                                   | `3a959702f93817747ffccd488eaf8aea5f2b96454418911c0e818e1811444844` |
| `test/webpack-versions/4.44.2/package-lock.json` | `4835cc58c88aafe2f747c32ac48c547ac57013b2c79df875edbccb220fa8dddd` |
| `test/webpack-versions/4.44.2/package.json`      | `6a7665d8edf9817db8a667d9663c102c90b775013619cbd1adc3166f0566e94a` |
| `test/webpack-versions/5.76.0/package-lock.json` | `132bfb5f9c1d335a4dbcb8a457b4e813d3e69ef8590746237b8fe8b11afe8942` |
| `test/webpack-versions/5.76.0/package.json`      | `c3a7dc7a33fb8dd1dcc00a2953d158c89b2e18af3a844e8ee40e5de3c833bcae` |

Reviewed baseline `test/__snapshots__/webpack-contrib+webpack-bundle-analyzer.json` has SHA-256 `b1312c89a719046fa9cfde0da5a7869b369172d7c13413bf6cb87136c2b5b7ab`: 1392 catalog packages, 5 projects and 5 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
