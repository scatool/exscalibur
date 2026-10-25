# microsoft/terminal native vcpkg acceptance

Commit `b4e69c68620a822407d45bfbba6ee10feebc70a3`, tree `661e371ea7fb5a138ace7d893d2254cc10c687de`, Git transport archive SHA-256 `327f23f42545d48cf2e6ecdbde3f6711df2a16ae95773ea4108b7d46dfd6b295`. Independent Git blob/tree reconstruction verifies every superproject file, executable mode and symlink; any gitlink is represented by its exact commit identity. Source file hashes before and after all commands were identical.

## Commands and provenance

All 16 configured harness extractors executed using the exact case configuration in test/repositories.json, Node.js 22.23.4 and pnpm 10.24.0. There were no ERROR or WARNING issues. The vcpkg checkout is tag 2026.04.27, commit `56bb2411609227288b70117ead2c47585ba07713`, tool version `2026-04-08-e0612b42ce44e55a0e630f2ee9d3c533a63d8bc1`. Its existing bootstrap verified the official binary checksum. VCPKG_ROOT names that checkout, writable download/cache directories are outside source, and metrics are disabled.

The root manifest's declared registry baseline is `fe1cde61e971d53c9687cf9a46308f8f55da19fa`. Native `x-package-info --x-json` batches were independently reissued in each discovered manifest directory, recursively covering every dependency and feature dependency. Captured native records, exact argument lists, exit status and stdout hashes are in `test/acceptance/vcpkg-native-microsoft+terminal.json`, SHA-256 `6f5e2a109eb8ef6072544bbb95cbedfbaf538c06a1c50d55cbce4a52585a2373`. This command intentionally returns status 1 with valid metadata; malformed output or another status is rejected. Native output is scoped to the supplied manifest directory, registry checkout and overlay configuration. The baseline and override declarations are preserved, but the command does not establish resolver-selected versions. No external registry was mutated and no package build/install was run for these integration cases.

Before these cases, the existing 20 native plugin tests passed, including four isolated fixture dry-run/depend-info comparisons. Those tests are separate evidence, not a claim of a native install plan for these three repositories.

## Semantics and discovery

Both the root manifest and dep/vcpkg-overlay-ports/fmt/vcpkg.json are existing discovered inputs, yielding two separate projects. Root metadata honors the visible overlay context, but is not version resolution: ms-gsl is reported as 4.0.0 despite the manifest override 3.1.0. The native fmt overlay reports 11.1.4. Root terminal feature declarations remain conditional and unselected.

Every discovered vcpkg manifest receives exact host and target roots. Registry records have complete declared adjacency, while every candidate binding has unknown selection. Platform, feature and supports predicates are retained independently of the analyzer host. No enabled-feature union, version-constraint satisfaction, installed graph, or runtime closure is asserted. Missing candidates would remain unresolved; no missing candidate occurred here.

| Manifest                                 | Captured candidate records |
| ---------------------------------------- | -------------------------: |
| `dep/vcpkg-overlay-ports/fmt/vcpkg.json` |                          2 |
| `vcpkg.json`                             |                          7 |

The persisted test `test/vcpkg-acceptance.test.ts` checks the complete source tree and matching-input inventory, native evidence hash, exact observation set, every port identity/host-target view and every request's name, constraint, feature, condition, binding and selection. Auxiliary Cargo records are checked against parsed native TOML with exact source/version disambiguation; requirements remain declarations. Core validation is additional evidence, not the semantic oracle. No legacy baseline was used.

## Input hashes

| File                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `dep/vcpkg-overlay-ports/fmt/vcpkg.json` | `ba385b6792cdb256faa2e18871f94fd78510c73f74947d167f31a7e939394a1f` |
| `vcpkg.json`                             | `7b28822f3ec29d30b36e16b7d27d4dc75b0f52d70e4e9c075a5fabffb108d9f2` |

Baseline `test/__snapshots__/microsoft+terminal.json` SHA-256 `dbe265da6c66c4b756725058e22da888345587bc67bcaea4968f8cc9123b9401` contains 7 catalog packages, 2 projects and 2 observations. Only Rustdesk's three expected cargo.raw_lock_projection HINT issues occur. Independent review and ledger acceptance are required before harness acceptance.
