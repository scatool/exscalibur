# tailwindlabs/tailwindcss format 2 acceptance

Exact source commit `91694fbfc14290381c92042d08b535ed1a3c8c44`, Git tree `4cfd62ffadad62b556a39883f0580e34489ff4dc`, explicit Git archive SHA-256 `3051372065a259efca2e30ee007ce489e645a33b16b78c1007d4bb85de5aa759`. Source provenance receipts and matching-input SHA-256 values are recorded in `mixed-workspace-sources.json`.

The complete archive source tree was reconstructed from file bytes, executable modes and symlinks and matched the receipt Git tree.

All 16 configured integration extractors executed. The candidate preserves these independently checked native observations:

- `cargolock`: 2 observations.
- `packagejson`: 2 observations.
- `pnpmlock`: 2 observations.

Manifest roots enumerate the exact four dependency scopes and preserve native requests. npm placement records, Yarn descriptor maps and pnpm snapshots are compared directly to parsed native tables, including request targets and conservative selection. Yarn effective resolver closure remains unobserved. Bun tuple records, workspace roots, native requests and nearest ancestor placements are checked independently; peers retain uncertain selection. Cargo retains exact raw package records and references, no inferred workspace roots or selected feature closure. The test asserts the complete matched-input inventory and hashes, graph counts, and exact warning/error code, severity and source-file multiset.

Counts: 982 packages, 28 subprojects, 6 graphs, 1311 nodes, 232 roots, 2327 edges.

Native source inputs:

| Path                                               | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `Cargo.lock`                                       | `22ae3e0579e8a14a9e6757ed071e8659c40f16664e479f7a533fe0902132ad03` |
| `Cargo.toml`                                       | `9ca285aef63c62cce7c8e986a9bc551be47e6b30b3e6a9ee0502a2264a647f59` |
| `crates/classification-macros/Cargo.toml`          | `2d8e668b81b362250d1b3b7e1a5aeb1d01544909bc782233c46c744adcc77f24` |
| `crates/ignore/Cargo.toml`                         | `c37102d264c03094aa0978b6d5a394f9a4ab439073cdce1675859b539dd591d1` |
| `crates/node/Cargo.toml`                           | `62c0f40a4b14b208e5ec50baed9ded56c17fa2e4553cd7bf02430bf42c677d6a` |
| `crates/node/npm/android-arm-eabi/package.json`    | `72b2839003275d17eb805047eeaebc1eacba78230b68ad6bed476efa07d04256` |
| `crates/node/npm/android-arm64/package.json`       | `9181a790d25b5c64b4c2ef87fe190cb9305a384b2d6c2c0406be0eb192dbaa98` |
| `crates/node/npm/darwin-arm64/package.json`        | `01dcce96a0c0c44927d7933990f5a6e2a8778461215902cd8e7519d2a7aa8a9c` |
| `crates/node/npm/darwin-x64/package.json`          | `6c263e1c837fad1806386e42e42d574820a70af678df99c9099eec43918bad81` |
| `crates/node/npm/freebsd-x64/package.json`         | `ed968c9d6a4d819aaaa10bb64e9c897f299910851ef4ae0e0311348690879eb9` |
| `crates/node/npm/linux-arm-gnueabihf/package.json` | `b4039a55e4ba45b0525f1413cf383180b54e366159b00a7ee5038d538eae177f` |
| `crates/node/npm/linux-arm64-gnu/package.json`     | `5e46997391b3664d8f58f3a3494c2d6660136f540665d42c6f904eefd1a4f0fa` |
| `crates/node/npm/linux-arm64-musl/package.json`    | `4504bbe1f6ab919cd802c4d0e4c3c92b06179d5b53101849885e027a3d97ae36` |
| `crates/node/npm/linux-x64-gnu/package.json`       | `8faa44748a1c2b7f0fe1bd6d85076f67d93864697a0f8daecf0852b0ef6830de` |
| `crates/node/npm/linux-x64-musl/package.json`      | `05aaa14870d581e4e3ffea63d2142d4ad03889a55422544ff2e1cead3c7ba691` |
| `crates/node/npm/wasm32-wasi/package.json`         | `bb7cd1a934ad338caa0ae67d408839b537392df5c1a73dda15851e397920868d` |
| `crates/node/npm/wasm32-wasi/pnpm-lock.yaml`       | `9edb46eed3f0365c44a55595d4e8bf773754f6af91b0f6f8d81b38b352443ce8` |
| `crates/node/npm/win32-arm64-msvc/package.json`    | `567674fce34dd201c94f27cf7a96462b0fc9203a7dd1abb8c41cebb34d8cab21` |
| `crates/node/npm/win32-x64-msvc/package.json`      | `dd46933b79d73a1b9e7d9e84befcef7e1a99e0001dd9f8971cd0e7ab0997b701` |
| `crates/node/package.json`                         | `86c36fd5f4cd85fbf21ab01144314aa4bc4a9b23d83f3be9dac6c45b3485b32e` |
| `crates/oxide/Cargo.toml`                          | `e20e2d39feeebcf00110e3f2a6720dc68dbe957f68529cff46df64b22a4d8996` |
| `crates/oxide/fuzz/Cargo.lock`                     | `a6ae93f5e8c16e0cad36b9f4905a6e2461b103aff770fe37d32543805f91f6bd` |
| `crates/oxide/fuzz/Cargo.toml`                     | `b36b7f0a5a3273fc3218ba8d55be778a96a161665a233d5022dca5c04f043309` |
| `integrations/package.json`                        | `83497276a58e448b1294d02529d25017ea333a7a3f94c99411c0778a4730643c` |
| `package.json`                                     | `cbaa14a98383e62cb13cd1f3357c7db8b5c685683ceee5036e78756b7ccf2d7c` |
| `packages/@tailwindcss-browser/package.json`       | `f6f337fc833c91d5da5e67d565a12217eb6f0a913aab44c66b1cc632c5fe2e2f` |
| `packages/@tailwindcss-cli/package.json`           | `07f6e664a80aec43a6f77ba2f468b5bf6a78e0fe3d5221302d88a79bb12c2559` |
| `packages/@tailwindcss-node/package.json`          | `f32869dcd797c5db29cc04a29d23f2ff91aaa1d277634a06201937e441d6f722` |
| `packages/@tailwindcss-postcss/package.json`       | `90437157a7e9af5b00a85eae22281f5fb3abbe575e13b667d6e9aaa41029117a` |
| `packages/@tailwindcss-standalone/package.json`    | `ebc6c278c8f1eb0ff3859f27ce5ad3fc95bf4b77c3d98595c44a4d711686dad7` |
| `packages/@tailwindcss-upgrade/package.json`       | `615898cf6d2b457afc192406d30466dfeb7ff7f656ee3de9c490c3a9c80a3475` |
| `packages/@tailwindcss-vite/package.json`          | `aaf9dd19c4ab53830291d89373897127f38df1031cd0a2dc688051e21678761c` |
| `packages/internal-example-plugin/package.json`    | `bf9d411753a91d88c1e29676adc9a29b974740ab666850ee4f0250e0db95eda5` |
| `packages/tailwindcss/package.json`                | `9d36171f9014046517480ea68824366b512fc3dbc3021c0ef27cef149266878a` |
| `playgrounds/nextjs/package.json`                  | `8412d1d37b5c8b1377cf1d6014630adee4728dfbab1d962198b47c6dec3ff7a9` |
| `playgrounds/v3/package.json`                      | `abf868a00d0f229885d73e0f8cb7a6317514a7197409e600d4d6cd3605d36903` |
| `playgrounds/vite/package.json`                    | `f164d76ff800e71a69c0621d438219007c62c4176e93767ddc6821296a6a4549` |
| `pnpm-lock.yaml`                                   | `521d963fa4d7cddf1d932cfa7d1a35ada23b56991abb9750c6a4e365c9c84ad1` |

Validation: `vp test run test/mixed-workspaces-acceptance.test.ts`. Independent review is required before the integration ledger accepts this baseline.
