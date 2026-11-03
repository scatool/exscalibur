# Redocly/redocly-cli format 2 acceptance

Exact source commit `2367722a9fb173e55626dccbdac7b6694dd8b199`, Git tree `9f3004dc7434ecdbdc17955e8aa0e6799a4114fb`, explicit Git archive SHA-256 `c77a79aba945295dced05485b082012187e1ec54d798ab2ca1ee747d69b429a6`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `packagelockjson`: 1 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 978 packages, 4 subprojects, 1 graphs, 1057 nodes, 16 roots, 2117 edges.

Native source inputs:

| Path                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `__tests__/smoke/package.json`         | `dddd5b1f76c8b442549d31f498bf9fa95170e63a9a79fa88d501d7c18fd9a496` |
| `__tests__/smoke-plugins/package.json` | `c7b8f47209e06c1f5e5e6788112621d1a205f2fa16296dd77a6e0cce673335ec` |
| `benchmark/package.json`               | `5ddd7fe393547deb5570272ea5cdba1ae16e76e2615b5f77edb7d32d750f37d0` |
| `package-lock.json`                    | `a19d9c3997ecb7272ed17abc4174475c2a393066050c47d69fe7face49ba03f4` |
| `package.json`                         | `abc66737cff9831b11f7d66a9ae447bd18bd410b24bd97ea4eefc5fcbfd360f7` |
| `packages/cli/package.json`            | `8a4d70e141ed02a2cb6c6d1cc98908d66b3666563eba89961f85aa777ef89381` |
| `packages/core/package.json`           | `e4aa9ad1e9e716499a459b5d39748165ac494eb525e082b8d5b02fe656f452f1` |
| `packages/respect-core/package.json`   | `f9453ed0bc7a97b7a4ab617a0fb250e39727125f4fc013449cb4c263374860cd` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
