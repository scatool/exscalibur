# midday-ai/midday format 2 acceptance

Exact source commit `ffd7791ef6d158006e96e5306b23fe7bb127048e`, Git tree `29ef8c95f4e470f611b487b6988c6a413756eea8`, explicit Git archive SHA-256 `77aad705d48aea26876544aa385be7ba4ab4a98e33494a28ce23cf953f07df50`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `bunlock`: 1 observations.
- `packagejson`: 1 observations.
- `cargolock`: 1 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 2740 packages, 28 subprojects, 3 graphs, 3341 nodes, 224 roots, 8352 edges.

The Bun manifest/lock mismatch warning remains: current manifest declarations and locked workspace requests are independently preserved. Cargo is a raw lock projection, not a build-plan assertion.

Native source inputs:

| Path                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/package.json`                | `3c467ce384fec976f8e831276c672df5681a9d96d87904654805b71e45ecc265` |
| `apps/dashboard/package.json`          | `8bcbcf72c1d77f4443872dca33e89e8fe6b9ed575c6ce9d99444642b1951e534` |
| `apps/desktop/package.json`            | `92e6bca8011c8abd66ff11a0232d768c3af5e06fd6447c2d9f3d93d7eaa16c86` |
| `apps/desktop/src-tauri/Cargo.lock`    | `a257c4be333128c7f8f29fcc9516b231939caa87feef56832f96170d88646bee` |
| `apps/desktop/src-tauri/Cargo.toml`    | `b608f137cbbfbce23a8a477ab4378a919037084f469d480512d7c9907cd5374f` |
| `apps/docs/package.json`               | `bf5ebfb5d18c4d7d981316b7a08df92f9abc3fc005334497e7ddac4fae0dc0f4` |
| `apps/engine/package.json`             | `036009954d121883c22cf1dfab0731b26624d84a141ae55890934a89b5a1deaf` |
| `apps/website/package.json`            | `65ca97e1f34868e0296832fdc3799251c70fca663cc473443b700bca7e27b50a` |
| `bun.lock`                             | `ac97b4aa910c09e085a03b015a9176341714805effdf8a5af67904295233ee50` |
| `package.json`                         | `497103a04e7f22724e404f461ee22b9dafa4d4f217289ec6ff0bb9da88a46840` |
| `packages/app-store/package.json`      | `373956156be942177a953b1ffd09bad0a2a965cb2f81ea57201512ae828ea5ff` |
| `packages/cache/package.json`          | `00a563bbf8fab8eaa6211ac2835d09b985637b859f3d7104f0b70238b48ddffa` |
| `packages/categories/package.json`     | `07f67ce03fe1db4ac7a03023c0cf02dc63b16eeffd627b28b0388cc05e1cfcd7` |
| `packages/db/package.json`             | `5c12721d64f32b51d57bc9e6c3bdfba75446fde8fb81990bba2c6a0e1bb6351d` |
| `packages/desktop-client/package.json` | `366787ac7a270801b5af02a68a8cf3b10d09e76bc3bec4113e358a66c94d9572` |
| `packages/documents/package.json`      | `34e762934ef15ee0c66ce2878ca6542802483e41af58a5c0212205332117f7eb` |
| `packages/email/package.json`          | `7e542b7626540f51d8408a33003e963c888b0faa16d35eb7a44dc5334d0e3a9f` |
| `packages/encryption/package.json`     | `238f93b2018fda5de66440b4d3846c200d5fd6ee993ae13a3eadea3194f506cc` |
| `packages/engine-client/package.json`  | `28e36cc7b3f10e94a0c155b8f61066e47c55cbf1edef8872aca542a5867dc61a` |
| `packages/events/package.json`         | `71c49976222a57bf034439402b04fa60624312f52bf053ae2a1de81a6f1abe9f` |
| `packages/import/package.json`         | `14aa3d443d9228d10050cc651c640c8cc80fb6882ed63b7f185928f8382c1883` |
| `packages/inbox/package.json`          | `a089cec9ce81f817f38e878e161726d3908068f8847cceaa8d68ed3a6be1087c` |
| `packages/invoice/package.json`        | `5acb203902633fb3d8154c9b062213a18304207004123cae9fe3acce276b6368` |
| `packages/jobs/package.json`           | `7a5d9ea745ecf06d94407e6047412159ea4fc71a3d3eb09cb98ca9d2e8c09436` |
| `packages/location/package.json`       | `433f322e64493f9a829a1d85e7d976cbaa3cc6e371502fda06521adeaa4d513e` |
| `packages/logger/package.json`         | `8d1da322310bf356e76285a506e1fd098534d680c49f5656cae7cb23df28165f` |
| `packages/notifications/package.json`  | `e77a48707a0638d0f17dfc3a3b12fe1694b1ada05441f0b92d47210a19107b05` |
| `packages/supabase/package.json`       | `6fe0dd6ace19d839f0583a9b2162433dfa1ac9cfb397b0f47fa8a75564991852` |
| `packages/tsconfig/package.json`       | `402e374dc067b2a073866c093627037dc549f3dfe2b5e13f564d51901cc0f00a` |
| `packages/ui/package.json`             | `157dcd9979462ca7d09594a74a544d98fe2afab822d9af001322cb445aff6dd2` |
| `packages/utils/package.json`          | `df1f9b82935174dd696264ae90bf88199652f5d9c603d70e81fa9d6d48fa5568` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
