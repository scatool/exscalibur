# xtuc/webassemblyjs format 2 acceptance

Exact source commit `af8e766c26d36c34c3b84c975d3dea96dcf22197`, Git tree `b3f1b86641f795742a4ad1d8fac4f61e6432b3f7`, explicit Git archive SHA-256 `c90ea957e493e86017ac61efc71f2f2862ac43364d97c61445c8528a58945f0e`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

Acceptance covers the superproject archive only. All superproject blob bytes and modes are compared against the fetched exact commit. The `testsuite` gitlink records commit `2375d1eec495d30827a6f7008cd5a09f86533b1d`; its contents were not fetched. Nested submodule inputs are absent and are not covered. `.gitmodules` is included in the evidence hashes.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `packagejson`: 2 observations.
- `yarnlock`: 4 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 1428 packages, 33 subprojects, 6 graphs, 3330 nodes, 264 roots, 6384 edges.

Native source inputs:

| Path                                              | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `package.json`                                    | `80e6e8f5606b07ea32207e715d012fe663df80adcc882ee17b2b136b2f4e2521` |
| `packages/ast/package.json`                       | `4f36de02cd165ae6e6c6b566632c29f0e5d20527ab7032515a6bfbc8ee6516b7` |
| `packages/cli/package.json`                       | `51a0ce7eaf3323d817ce9093cb876efc436ebf628492c879dc44af57250bbb3f` |
| `packages/dce/package.json`                       | `24cea330717cc4417e3e60d0a4bd23cdf8544ff214d0bcd0aea2152020348021` |
| `packages/eslint/package.json`                    | `e3dbfdee152e1c7403916fd4df42404469883e2d17bfc5c00ae144a23a865699` |
| `packages/floating-point-hex-parser/package.json` | `39dc098103e54cc010a75a4f04dc68e55bd6ef6343febcb3af99d90aa301b18c` |
| `packages/helper-api-error/package.json`          | `d5ce1758aa12952258ccd901b74a8d81e0d719e199d7cfdaccd773eb92bcf16e` |
| `packages/helper-buffer/package.json`             | `a34d969bfdaf3a19b3351e719ad9a4c0d18a362dd3087a4dde9e66f0877d8395` |
| `packages/helper-code-frame/package.json`         | `895a66647803a9ab368f827e913cef3a67426f36a6836636b94a60eb1ac34ef1` |
| `packages/helper-compiler/package.json`           | `7ae4d7b8dfdfc3718ed14a7a7cc57b14b9abb04181186fc7c089bb2699c3bb1c` |
| `packages/helper-flatten-ast/package.json`        | `b1c7138226ad726f80ccd32d99298ed7d4051a35154e76b3e755f20b171d39cd` |
| `packages/helper-fsm/package.json`                | `a65321ec4bc9d0a17bee45747b504b1dd371b7a070decd8192a834ef275f60ca` |
| `packages/helper-numbers/package.json`            | `54ac947d89a0f7b8e108ff9794710de410390ac30afe0a01a049f89fe488417f` |
| `packages/helper-test-framework/package.json`     | `8d0b5d3e6b578ad68d1c3cfa5ee91f802c3b4a1be3f01567ade82206234f7bd7` |
| `packages/helper-testsuite-runner/package.json`   | `258717e7801ab23ed70a467b2ce80dd25cc4cfa98e3e9bbbd2e5174b08a97e8d` |
| `packages/helper-wasm-bytecode/package.json`      | `6be588199d61edda20e745c9f6da4af282210d5a098620fbce601c8c6ad40732` |
| `packages/helper-wasm-section/package.json`       | `23f3b9a0ef5f047a419f75e72ed5004af3f818387b1eb5dd7e9543002ecd3730` |
| `packages/ieee754/package.json`                   | `816cb9cfd394bdc9cc3bf4d998a7d90cd32f12c4e5dd12dec44573849186df44` |
| `packages/leb128/package.json`                    | `5c49bd9a15aab649ec463a12e2841a74b366541e2a6c8ce294e872ac652f54be` |
| `packages/repl/package.json`                      | `09eb3dce81908cee5e96d6ae255a9ef4083dc7301245da8bfd439ebe313c740e` |
| `packages/utf8/package.json`                      | `80b5bd466aa18681f5afe2a3f5438ca2753e174b2b38cf9c65a91207d80722c3` |
| `packages/validation/package.json`                | `d3b07fd64fcc74a4624c2d75d399ba254add4928772417efca338f8542292874` |
| `packages/wasm-edit/package.json`                 | `63869fa13b280cd0a880847179854e8492aa2fb8ea129ad2e65c625ea7fcefb4` |
| `packages/wasm-gen/package.json`                  | `5e5e79dbcc261a482d0d6179de52dc1a10489a58608f681758cf8529ca375288` |
| `packages/wasm-opt/package.json`                  | `b166be5e21aa5c73d4e4534bca4127b876e12f58a8b2235524e09d4367615133` |
| `packages/wasm-parser/package.json`               | `98b3d029765145ab286786964bfc6d64183ca8128c612ddd3e5270bc90e6fbfd` |
| `packages/wasm-text-gen/package.json`             | `cab5d30e8154d8e09328bc566c42d33ef2811ec7931ee2d59b008a1eade0cde2` |
| `packages/wast-loader/package.json`               | `2a780a78f71d523bf1158d7e7f7e586a2cb22f2ac013447057857e343b968886` |
| `packages/wast-parser/package.json`               | `abff521d558e1582bd1952890acacb514ad845b1212d5ebb615dd6457be940b4` |
| `packages/wast-printer/package.json`              | `8e3bfa12fa2c934a499df0b2bf3a86b076c94d755a0174e4e62bd35464864b49` |
| `packages/wast-refmt/package.json`                | `86e2ab2514b123a8e04611ff7f1202b038c49a325d768059c6577a79071bc93e` |
| `packages/webassemblyjs/package.json`             | `47c25b338808801abf8dfbacfccf85b2a88a2e9cdce065dd076bf2717e2d4bde` |
| `website/package.json`                            | `bdf9c099f5705e469aaf1f8d4fe80fda9267624f295e0e153ba86a83450713d4` |
| `website/yarn.lock`                               | `da875a7264502dbfbf4febce2bace85ccadcc327f2d44c8e316c6e108ea4ac50` |
| `yarn.lock`                                       | `0e471d4fa8d725856bd7f16eda5499cd08d60568423010e6558e4d23a1312c62` |
| `.gitmodules`                                     | `305ebc3195d58871047882ee895d9d97895fe08e9e2f7c6d5590520031e7f4d6` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
