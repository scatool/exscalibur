# xyflow/xyflow format 2 acceptance

Exact source commit `5cfd4a56d157bb23a7e8152f569f3f0841c7e3d1`, Git tree `41bedd359e76c64a7cd14ed17b50a54f091ae995`, explicit Git archive SHA-256 `f98b6714945eeb4c059e6d5ac1da3d1797d4c20aaa95c87c794813b6aaac4ae2`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `packagelockjson`: 1 observations.
- `packagejson`: 1 observations.
- `pnpmlock`: 1 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 1500 packages, 11 subprojects, 3 graphs, 1746 nodes, 92 roots, 3925 edges.

Native source inputs:

| Path                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `examples/astro-xyflow/package.json` | `42118d1a3fafd01a4f0452cfa862de8c32161b9bac08276db7236a6b31bfbd3f` |
| `examples/react/package.json`        | `1419dada5bae1593200d9d0bb8ac2d8b7ecc1ed3fc467f6c405dccb901c0c723` |
| `examples/svelte/package.json`       | `f640245a9a866f0396c3fc34121c332fe583a64e3d2c4d928c91019c26046001` |
| `package.json`                       | `5ce8c826877d3028c31729daa27d76aff8e28d1f087115052c289104938332f9` |
| `packages/react/package.json`        | `db71fc8642a61ab6de309f1b883a426af3dcabb45a227b30b511c6a80e920cae` |
| `packages/svelte/package.json`       | `15230a95fd76f79ea82b87f22928068b26b690309392cb1a8bda616455122c54` |
| `packages/system/package.json`       | `0fa9f62d16b5851c51c25a99ad53ab161f4b8b4a6f3468b5a3a3b65e43bbe829` |
| `pnpm-lock.yaml`                     | `b478be33f106d0ee69a90c6ca9dab0d0ce59d5a34c0a9516b31feb2273a3828b` |
| `tests/playwright/package-lock.json` | `fae783d4355c2e1a48542d4cd53bb24a18a9ab751b1207b5828d0f175a2e5bf8` |
| `tests/playwright/package.json`      | `075cae8696210bb8248e5b5e0da6676449b555e0d92946f66e7802a7123f9f38` |
| `tooling/eslint-config/package.json` | `f5ae2615f3eeddf0985b7fdf9aafacd4192f8d6cb956c6a9c868aa3043a540c8` |
| `tooling/rollup-config/package.json` | `1b27ef6af6fc879c06ef48d76582fc478de6bd944beaa3a6943735413a7bb7fe` |
| `tooling/tsconfig/package.json`      | `6ca5ec905562d7a609a1a6841471910a5957c368fcb4b086db1889942c5d2e2e` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
