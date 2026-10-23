# Mail-0/Zero format 2 acceptance

Exact source commit `64c5480c341750578da0746f2db9ad84da686334`, Git tree `6c53d508e58e7a9d8facbeebf3c0ce46b17d5b63`, explicit Git archive SHA-256 `cead9197b27e09531766ea847ce111858b5e3a5486ba17162e927d6e9ef30bdd`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `bunlock`: 1 observations.
- `packagejson`: 2 observations.
- `pnpmlock`: 1 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 1970 packages, 8 subprojects, 4 graphs, 2103 nodes, 64 roots, 5331 edges.

Native source inputs:

| Path                                  | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `apps/mail/package.json`              | `f53fe8bca82a695ec5a4684bf116a769adab7d7ee9f2e0d7aa3765b88c4b9072` |
| `apps/server/package.json`            | `e995a041e5da437a580534994d286340fd6a5db91f3f2afd1d149923af8bbc3e` |
| `package.json`                        | `783dcd62e370ff78296d4d1456304ebffd97f59fb1ba6b95fb672b0b12fffe17` |
| `packages/cli/package.json`           | `d4aab47dd7a78c01f66996531508a02f746334651ec390a1d505f649b3c13924` |
| `packages/eslint-config/package.json` | `efdfcd86af367aada4362f9421cbf09032cf6d898b567445db71565afa4e6d14` |
| `packages/testing/package.json`       | `2b7461bb53fb6f73262889f0c6b2bb970ed88509ac4a22b12065fccac58039d7` |
| `packages/tsconfig/package.json`      | `1f50946a1bcf3a6ee3c34f94c3bd3076499ebbf850904011f0ed39a78533ad93` |
| `pnpm-lock.yaml`                      | `d2bc81a7d840aabc66d94a9b236a441f407ec6f1d77cd4141222898a94ca816a` |
| `scripts/bun.lock`                    | `466ba9a76be99c4068734d8ebf0ead13adea6d25bc22f091b8a6ccf02cbe28b8` |
| `scripts/package.json`                | `8fb0f0de887657502dcd43562affe834a726fb1751707eb75a3e2482fdf63712` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
