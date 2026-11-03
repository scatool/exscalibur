# Corvusoft/restbed native vcpkg acceptance

Commit `e1227a297ce6d4e9f78222456507b29bb8ab77e9`, tree `c3ad9f74a95b55a762f21c2400e7394999cb68b2`, Git transport archive SHA-256 `319e190ece8e1a55bb27d2c947ea1ae78c295dbbada422b672028c074aa56c83`. Independent Git blob/tree reconstruction verifies every superproject file, executable mode and symlink; any gitlink is represented by its exact commit identity. Source file hashes before and after all commands were identical.

## Commands and provenance

All 16 configured harness extractors executed using the exact case configuration in test/repositories.json, Node.js 22.23.4 and pnpm 10.24.0. There were no ERROR or WARNING issues. The vcpkg checkout is tag 2026.04.27, commit `56bb2411609227288b70117ead2c47585ba07713`, tool version `2026-04-08-e0612b42ce44e55a0e630f2ee9d3c533a63d8bc1`. Its existing bootstrap verified the official binary checksum. VCPKG_ROOT names that checkout, writable download/cache directories are outside source, and metrics are disabled.

The root manifest's declared registry baseline is `05442024c3fda64320bd25d2251cc9807b84fb6f`. Native `x-package-info --x-json` batches were independently reissued in each discovered manifest directory, recursively covering every dependency and feature dependency. Captured native records, exact argument lists, exit status and stdout hashes are in `test/acceptance/vcpkg-native-Corvusoft+restbed.json`, SHA-256 `dd9708de5939073ef508e13f9d5cb07c7b708540093b92f5632b00b284d39058`. This command intentionally returns status 1 with valid metadata; malformed output or another status is rejected. Native output is scoped to the supplied manifest directory, registry checkout and overlay configuration. The baseline and override declarations are preserved, but the command does not establish resolver-selected versions. No external registry was mutated and no package build/install was run for these integration cases.

Before these cases, the existing 20 native plugin tests passed, including four isolated fixture dry-run/depend-info comparisons. Those tests are separate evidence, not a claim of a native install plan for these three repositories.

## Semantics and discovery

The manifest requests asio, catch2 and openssl. The recursive metadata queries report 36 candidate ports, including all source feature declarations. These become 72 host/target views and two exact roots, with 315 requests.

Every discovered vcpkg manifest receives exact host and target roots. Registry records have complete declared adjacency, while every candidate binding has unknown selection. Platform, feature and supports predicates are retained independently of the analyzer host. No enabled-feature union, version-constraint satisfaction, installed graph, or runtime closure is asserted. Missing candidates would remain unresolved; no missing candidate occurred here.

| Manifest     | Captured candidate records |
| ------------ | -------------------------: |
| `vcpkg.json` |                         36 |

The persisted test `test/vcpkg-acceptance.test.ts` checks the complete source tree and matching-input inventory, native evidence hash, exact observation set, every port identity/host-target view and every request's name, constraint, feature, condition, binding and selection. Auxiliary Cargo records are checked against parsed native TOML with exact source/version disambiguation; requirements remain declarations. Core validation is additional evidence, not the semantic oracle. No legacy baseline was used.

## Input hashes

| File         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `vcpkg.json` | `f42348f04a1d850dacc645774562a43f34b63d6a61998656a82fb9ae66f1d57c` |

Baseline `test/__snapshots__/Corvusoft+restbed.json` SHA-256 `88760ec83874cb17e900772db07b1890b5c7d8251fa81bc988e147d5ca0b84f1` contains 36 catalog packages, 1 projects and 1 observations. Only Rustdesk's three expected cargo.raw_lock_projection HINT issues occur. Independent review and ledger acceptance are required before harness acceptance.
