# rustdesk/rustdesk native vcpkg acceptance

Commit `1abc897c451c8b5bbff3792509a7fef9d12f2ce3`, tree `06adad5af684e0cdcba101558ade135a152901b6`, Git transport archive SHA-256 `a85cb65b7b0e32e720fa1e3e3ed566795be8d83000c63d849db6a62976c6da51`. Independent Git blob/tree reconstruction verifies every superproject file, executable mode and symlink; any gitlink is represented by its exact commit identity. Source file hashes before and after all commands were identical.

## Commands and provenance

All 16 configured harness extractors executed using the exact case configuration in test/repositories.json, Node.js 22.23.4 and pnpm 10.24.0. There were no ERROR or WARNING issues. The vcpkg checkout is tag 2026.04.27, commit `56bb2411609227288b70117ead2c47585ba07713`, tool version `2026-04-08-e0612b42ce44e55a0e630f2ee9d3c533a63d8bc1`. Its existing bootstrap verified the official binary checksum. VCPKG_ROOT names that checkout, writable download/cache directories are outside source, and metrics are disabled.

The root manifest's declared registry baseline is `120deac3062162151622ca4860575a33844ba10b`. Native `x-package-info --x-json` batches were independently reissued in each discovered manifest directory, recursively covering every dependency and feature dependency. Captured native records, exact argument lists, exit status and stdout hashes are in `test/acceptance/vcpkg-native-rustdesk+rustdesk.json`, SHA-256 `6eb4ecf7fa9dee23cf1516d00a821b32ac1f4807f37de442d7f4e297fb7dc91c`. This command intentionally returns status 1 with valid metadata; malformed output or another status is rejected. Native output is scoped to the supplied manifest directory, registry checkout and overlay configuration. The baseline and override declarations are preserved, but the command does not establish resolver-selected versions. No external registry was mutated and no package build/install was run for these integration cases.

Before these cases, the existing 20 native plugin tests passed, including four isolated fixture dry-run/depend-info comparisons. Those tests are separate evidence, not a claim of a native install plan for these three repositories.

## Semantics and discovery

The root plus six res/vcpkg overlay manifests produce seven independent observations. Explicit host/target duplicate requests, platform expressions, conditional requested features and overrides remain intact. Native metadata reports amd-amf 1.4.36 despite override 1.4.35 and ffnvcodec 12.2.72.0 despite override 12.1.14.0: these are registry candidates, not solved versions. Three Cargo.lock files also contribute 1,208 native records and 3,704 exact source-disambiguated bindings with unknown workspace/root coverage. All Cargo.toml files are context only. libs/portable/requirements.txt contributes one unbound brotli declaration; no Python installation is claimed. The configured Gradle ignore **/flutter/** excludes both Android build.gradle files; no Gradle execution is claimed. The superproject gitlink libs/hbb_common at 48c37de3e6c4e399af6f51ca20e8e3e1fd037976 is verified from the pinned Git tree, but no submodule bytes were fetched or analyzed. Complete source means the pinned superproject, not its submodule contents.

Every discovered vcpkg manifest receives exact host and target roots. Registry records have complete declared adjacency, while every candidate binding has unknown selection. Platform, feature and supports predicates are retained independently of the analyzer host. No enabled-feature union, version-constraint satisfaction, installed graph, or runtime closure is asserted. Missing candidates would remain unresolved; no missing candidate occurred here.

| Manifest                            | Captured candidate records |
| ----------------------------------- | -------------------------: |
| `res/vcpkg/aom/vcpkg.json`          |                          2 |
| `res/vcpkg/ffmpeg/vcpkg.json`       |                          9 |
| `res/vcpkg/libvpx/vcpkg.json`       |                          6 |
| `res/vcpkg/libyuv/vcpkg.json`       |                          4 |
| `res/vcpkg/mfx-dispatch/vcpkg.json` |                          1 |
| `res/vcpkg/opus/vcpkg.json`         |                          2 |
| `vcpkg.json`                        |                         18 |

The persisted test `test/vcpkg-acceptance.test.ts` checks the complete source tree and matching-input inventory, native evidence hash, exact observation set, every port identity/host-target view and every request's name, constraint, feature, condition, binding and selection. Auxiliary Cargo records are checked against parsed native TOML with exact source/version disambiguation; requirements remain declarations. Core validation is additional evidence, not the semantic oracle. No legacy baseline was used.

## Input hashes

| File                                    | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `Cargo.lock`                            | `b726aea17394df482b5c858d27de052b9c6180b47b3d3d6441a69a649e76431f` |
| `Cargo.toml`                            | `463f96369c2a96adc399ef8530aca95080b65c8581bcd0a228965e04695d9672` |
| `flutter/android/app/build.gradle`      | `93a91da0a3920d7400c54fa59d3cd34e3e0bf08e0f4d0d5ff292d1535b3246d7` |
| `flutter/android/build.gradle`          | `7e40b7549d2ac8a856f26cbbe6a092bb4f5c361b88e5df59e5203f10c5c1f59e` |
| `libs/clipboard/Cargo.toml`             | `d9bd12481e648a5f3e1d22fbe0e33e8eb266d7509ff84617f0b86b5dde1dff21` |
| `libs/enigo/Cargo.toml`                 | `8fc75bdf9f3b5084a650fdfeb05ff6576d3cf130a8264a0f7f86af3c7fe07c2c` |
| `libs/libxdo-sys-stub/Cargo.toml`       | `ade32fc22d57e0993729951ea5389d95f410823a27e0e040ca58a725626f4734` |
| `libs/portable/Cargo.lock`              | `976ddf4aa7d9d41407c4d4ac8990ac81f61e580591b419abddf8137567223432` |
| `libs/portable/Cargo.toml`              | `6205de2e9d6438a84f0b34fcd658f56c65bc34166d6eeac4eacbfea8f9d7b603` |
| `libs/portable/requirements.txt`        | `ad55a1e091237e55585f95e3ee7107710778aa6841c2c081e6beb1b26e5d66eb` |
| `libs/remote_printer/Cargo.toml`        | `c5601a13e9fd3e051f444bc01336e45f02d35c4675d905406b16d72a471a2bfd` |
| `libs/scrap/Cargo.toml`                 | `44c2d066911450d3307b68ed951607e39267775e0d77802144cdfc76e24c8bfa` |
| `libs/virtual_display/Cargo.lock`       | `d5ac2e0574d0e1974f733813284344704c75a9805f1fd58d5834a9fad411e744` |
| `libs/virtual_display/Cargo.toml`       | `3c241ec655632a6e6f60a767b8418b6590dd08b851d5a77e58bede2a0fe1beb6` |
| `libs/virtual_display/dylib/Cargo.toml` | `e0b97e29b7420f3d464902dbfb42b1af32ce1971d578ca4a629fd5d880490576` |
| `res/vcpkg/aom/vcpkg.json`              | `ab07bb3f134547fd47637224fdf9e0c5436642456164cf607c18cbf84bd8fd76` |
| `res/vcpkg/ffmpeg/vcpkg.json`           | `8fff9b6c4aaf0823f9ea6c3844ae095e431d1fac8423ba490fd55bd0e1041d18` |
| `res/vcpkg/libvpx/vcpkg.json`           | `05dc986d13aa44ac0d85f08bc2198efa25df707ba1ebbc6975cce9aaa7d7cc0a` |
| `res/vcpkg/libyuv/vcpkg.json`           | `dab305a9a588db5997d6d009fadd9f786f2aa564566f71e5dffa836f82706b71` |
| `res/vcpkg/mfx-dispatch/vcpkg.json`     | `5d83e0a3cc4b226a95b7342382d0d7fe6bfbd8ea376030592a4fcc32d1124885` |
| `res/vcpkg/opus/vcpkg.json`             | `024bb3bdbf503bebb3033149127cff008e83de347efb17534ece30dfa2f10690` |
| `vcpkg.json`                            | `448eff48c7c8c68bf5a359a2ef924188ef71e440d2fc198ac5ae801c965b2000` |

Baseline `test/__snapshots__/rustdesk+rustdesk.json` SHA-256 `1374bf9889fddbcb848ae9325efd9e0b174545a5a93809f27e6e6a239779bd69` contains 1188 catalog packages, 8 projects and 11 observations. Only Rustdesk's three expected cargo.raw_lock_projection HINT issues occur. Independent review and ledger acceptance are required before harness acceptance.
