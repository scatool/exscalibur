# riehlegroup/msadoc format 2 acceptance

Pinned commit `7cc6b2f1f5c597d733a8a7bdb77905a16047e06c`, independently reconstructed Git tree
`252f1d34eaad63a46f010b12e46027ee341e78ce` over all 268 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `47bdc3ec8018b642081945eb5949bdee25d6637bb82d1eef4a2a95f790d7adc7`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The root lock identifies cli, client-generated, client-generator, frontend and server workspaces. An independent current root declaration graph and manifest-lock mismatch WARNING are preserved. The five workspace identities and all locked requests remain in the lock observation.

| Extractor       | Source              | Nodes | Requests | Roots |
| --------------- | ------------------- | ----: | -------: | ----: |
| packagejson     | `package.json`      |     5 |       12 |     4 |
| packagelockjson | `package-lock.json` |  1226 |     2937 |    24 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

- `npm.manifest_lock_mismatch` WARNING at `package.json`: The current manifest differs from its lockfile declarations; locked dependencies and current declarations are separate observations

## Input hashes

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `cli/package.json`              | `d69bb78773b537481137d98f074f8472c1f5ab46be6bf1926f263a5ae5b831ed` |
| `client-generated/package.json` | `ee21ecfdba9b94fbb537b05252b98e721d2f7634c4f863f06be761fb819850ac` |
| `client-generator/package.json` | `c4025beb2fb77e7709cbfe9b074d87fbcac8b3d9972ba8ffc62d9d3398388af6` |
| `frontend/package.json`         | `bd4383eb599cc27fa123cc725248c73487c27daee8dcf164fce7852726c758bd` |
| `package-lock.json`             | `b1bddbd2f7145a57ff3ce42d08b4698740a36ebde8da2f460c9001e8533e15b2` |
| `package.json`                  | `afc656ac2cfbd451980c36cd1989b981ac5539d4a041421fa3070e5290b57452` |
| `server/package.json`           | `f1b90fa6f13d9f9de9f8bd6bc22ffae6d68104855e0c734642d8794f12543925` |

Reviewed baseline `test/__snapshots__/riehlegroup+msadoc.json` has SHA-256 `374de28804ec428562a4c812f6a3f7bedfd7450d45584f5f8e7d30274be02467`: 1108 catalog packages, 7 projects and 2 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
