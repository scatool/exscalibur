# linear/linear format 2 acceptance

Pinned commit `5a308978229da2aa092177055446669af657c034`, independently reconstructed Git tree
`4b9464470966f49e07daef55f040772a632079f0` over all 174 files including executable modes and symlinks.
Explicit Git transport receipt archive SHA-256: `ebd17b1d296db079c1c5934360837392073a8980324d46a54577d71de7d71c48`.

## Execution and source review

All 16 extractors configured by the integration harness executed against the complete source using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only JavaScript inputs matched; the other configured ecosystem extractors returned empty results without errors. All matching manifest and lock paths are inventoried below, including nested fixtures. No package-manager install, native dependency resolution or build was run. This is parser acceptance against pinned source bytes, not native execution acceptance.

`test/javascript-lockfiles-acceptance.test.ts` independently reconstructs the full Git tree and asserts the exact input inventory. It compares every emitted native record and every request against source tables: npm placement/link lookup, workspace roots, native request kind/specifier, optional-shadowing, peer uncertainty, platform conditions, target identity, binding and selection. It also checks the complete catalog set, exact observation counts, declaration project sets, four scopes per manifest and expected issues. Yarn syntax uses the existing syntax parser only; target lookup and assertions do not import production converters or identity helpers. Normalization/schema validation is additional validation, not the semantic oracle. No V1 output or automatic snapshot update was used.

The root manifest enumerates packages/*; the five direct package manifests are included. packages/sdk/webhooks/package.json is beneath the SDK package, is not a listed workspace member, and is suppressed by ancestor-lock discovery. Its declarations are not asserted as extracted. The example is a separate manifest/lock observation. Classic raw records and current-manifest scopes remain independent; raw lock roots are unknown.

| Extractor   | Source                                                                                                                                                                                      | Nodes | Requests | Roots |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------: | ----: |
| packagejson | `examples/nextjs-file-upload/package.json`                                                                                                                                                  |     5 |       12 |     4 |
| yarnlock    | `examples/nextjs-file-upload/yarn.lock`                                                                                                                                                     |   132 |      156 |     0 |
| yarnlock    | `examples/nextjs-file-upload/yarn.lock`                                                                                                                                                     |   137 |      180 |     4 |
| packagejson | `package.json`, `packages/codegen-doc/package.json`, `packages/codegen-sdk/package.json`, `packages/codegen-test/package.json`, `packages/import/package.json`, `packages/sdk/package.json` |    30 |      117 |    24 |
| yarnlock    | `yarn.lock`                                                                                                                                                                                 |  1689 |     3649 |     0 |
| yarnlock    | `yarn.lock`                                                                                                                                                                                 |  1719 |     3883 |    24 |

## Coverage and issues

Locked npm placements describe the recorded lock graph, not an installed tree. Peer candidates remain uncertain and platform predicates remain conditional. Yarn output describes raw lock adjacency and separate manifest scopes, not a native effective resolver graph or proof of platform/peer activation. Classic raw adjacency and root enumeration retain their unknown markers; declared consumer adjacency remains unknown. Unknown closure must not become an empty successful dependency claim.

- `yarn.raw_lock_projection` HINT at `examples/nextjs-file-upload/yarn.lock`: Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed
- `yarn.raw_lock_projection` HINT at `yarn.lock`: Yarn graphs preserve raw lock descriptor bindings; effective resolver transformations and virtual peer contexts were not observed

## Input hashes

| File                                       | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `examples/nextjs-file-upload/package.json` | `c4be58f292587f1fab5c1ed12f0ed85e62ae8cf91bef7b13d550fa561bb46819` |
| `examples/nextjs-file-upload/yarn.lock`    | `37db0b3a390de894dc6e8a4be4d2072508f4aa2aeb5e8f211df8577b3ff39068` |
| `package.json`                             | `83bb12d0753cdec8dcebe22fcbf3fc0bb3b15d9eaf879e457c404150450df802` |
| `packages/codegen-doc/package.json`        | `e0d4d44e9d7daac8b142ca4812fdf16a9c32de238f06fb0c20edac0bfd279f77` |
| `packages/codegen-sdk/package.json`        | `64ac9a91d33259b43e9b0188ed602cdc38ebc5579df49d1d8bd6da9fc741d7ca` |
| `packages/codegen-test/package.json`       | `edb0d5522a0a9e23c24716f3f0dc58186381d313a058bb8ba4d83bbe82ae5bf1` |
| `packages/import/package.json`             | `b6e28c6fe42795708f22db37e60f449c46a66c22ee4f3104d3ade075e14c19e5` |
| `packages/sdk/package.json`                | `a945b9d3bbb0f728d4a85e71c574a979a9b8289648d069f1d3ab20a2b20cbbe6` |
| `packages/sdk/webhooks/package.json`       | `597eecbd5a20a444badf108a6b6ae99ada298b59f8684d666c83812df9686e1c` |
| `yarn.lock`                                | `dca1a3c296320ff82561facba51b368ecffec77749f1298afa1dc61db93bc007` |

Reviewed baseline `test/__snapshots__/linear+linear.json` has SHA-256 `82112e4ae41338f8ce12055c02ff98b35f0318fe0f1c0bf3a4591b6b518f6591`: 1772 catalog packages, 7 projects and 6 graphs. Acceptance requires the persisted semantic test and independent review in the migration ledger; this document alone does not mark a case accepted.
