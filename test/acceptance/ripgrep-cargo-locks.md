# BurntSushi/ripgrep format 2 acceptance

The complete pinned source of `BurntSushi/ripgrep` at `0a88cccd5188074de96f54a4b6b44a63971ac157` was recovered
using explicit Git transport. The fetched commit was checked against the configured
pin. Independent Git blob/tree reconstruction over all 220 files, executable modes
and symlink contents reproduced tree `4906fc180038c07fb8a68171a89f6422f5cfb5e1`.
The source receipt records archive SHA-256
`1fa3cc996aa1cbc106a37773ad51a7c2f2bbd2418683059c2b77f4483f25eba0`.

## Discovery and execution

All file paths in the verified tree were inspected against the 16 extractor input
patterns in `test/integration.test.ts`. Only the Cargo lockfiles listed below match.
The Cargo manifests listed in the input hash table were inspected as context but the
configured lockfile extractor does not consume them or infer workspace roots from
them. No matching JavaScript, Go, Gradle, Python, Conan or vcpkg input was found.
Other source files and workflows do not expand the configured extractor scope.

All 16 configured extractors executed with namespace
`integration:BurntSushi/ripgrep@0a88cccd5188074de96f54a4b6b44a63971ac157` using Node.js 22.23.4,
pnpm 10.24.0 and Vite+ 1.3.0. `cargolock` produced 2 observations;
the other 15 extractors produced empty results with no issues. Every nonempty
observation reports the expected `cargo.raw_lock_projection` HINT. No WARNING or
ERROR occurred. Results were merged and normalized with the core format/reference
validator. No Cargo executable, metadata command, registry request or native build
was run. Independent initial comparison used Python's `tomllib`; persisted assertions
use a separate strict parser for the small TOML subset present in these exact locks.
Neither comparison imports the production Cargo converter or identity helpers.

## Native records and boundaries

| Input             | Package records | Native dependency references | Source-less records |
| ----------------- | --------------: | ---------------------------: | ------------------: |
| `Cargo.lock`      |              61 |                          137 |                  10 |
| `fuzz/Cargo.lock` |              21 |                           33 |                   2 |

All 82 native package records and 170 dependency references match
one-for-one. For each record the assertions check name/version/source identity,
raw metadata, evidence, checksums/artifacts, catalog provenance and outgoing records.
Each dependency target is independently located by its native name and, when present,
version. Every reference in these inputs has exactly one candidate; version-qualified
references disambiguate repeated crate names. The result retains the original lock
reference, without inventing a manifest version range. It preserves each binding's
graph-local source and target, selected status and native dependency kind.

Registry records identify crates.io packages. Source-less entries use scoped generic
identities with explicit source provenance; they never become fabricated crates.io
identities. No target or feature variants are asserted. Native adjacency is complete
for the recorded lock tables, which is not a claim of complete effective resolver or
runtime adjacency. Each graph is `locked`, explicitly marked `raw-lock-records`, with
workspace membership and effective feature resolution `not-observed`.

There are zero project entries and zero scope roots. Root enumeration remains
`unknown`: neither source-less lock inventory nor nearby manifests are promoted to
workspace membership. Attempting a root query without a reported root fails. Thus this
acceptance does not establish project-scoped transitive closure, activated features,
platform applicability, compilation units, installed artifacts or runtime usage.

The root manifest explicitly lists nine member crates, while `fuzz/Cargo.toml`
declares its own one-member workspace. Both independent lock observations are retained,
including `fuzz/Cargo.lock`; the baseline does not merge their views or infer a shared
workspace. The root lock contains 61 records/137 bindings and the fuzz lock 21/33.

## Input hashes

| File                         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `Cargo.lock`                 | `8aee2707b876453e57e5b89846ab5b33d429a4e0d1f5a95f7c8622db130cf59f` |
| `Cargo.toml`                 | `cd4c90231547716fd7a935289d7221376105c8112249cdc38af8075a2171d3d2` |
| `crates/cli/Cargo.toml`      | `b24e072950632ed43ab628602a8e4202a1e6dde4d62b3da4321692028c05cb16` |
| `crates/globset/Cargo.toml`  | `f547f7255d0c852dd7589b73e48b071e730a7df911630abb4db70f60ac6a0ff1` |
| `crates/grep/Cargo.toml`     | `6c23af13f11a36bf47d5ff3173d9ac61b91cd189466ac42305cd79d35c2156da` |
| `crates/ignore/Cargo.toml`   | `e6b5176e4ee1c07deb8bf64024ef91fa677a971b70680987dee1db35bbd8836c` |
| `crates/matcher/Cargo.toml`  | `366590fa825704243df0a6a4f85da6b84efb76ba5758bb26406c493520c8c564` |
| `crates/pcre2/Cargo.toml`    | `2f0a5fc3a4a723acc6ec78c8a1194deae098cbf46899d64ecd1bb0fd1c50718a` |
| `crates/printer/Cargo.toml`  | `6edd8dcf4d1951b322267f2dda06069b39d1c04c202a5593b1d3cb6ea9b7b4ae` |
| `crates/regex/Cargo.toml`    | `2da48951703c48138a063bcfc8cb5d5748f03c7fedf3443ed0d0bfde24a870e9` |
| `crates/searcher/Cargo.toml` | `561cde7a7a58785749e4e5b2980bc285dfc96eb56f19ea3d929982b66fffcc1c` |
| `fuzz/Cargo.lock`            | `b6ee1b9ef968066415e092559b86212ea06150535f6463db9a6b0d4c2aa36ced` |
| `fuzz/Cargo.toml`            | `b8948efb524b815c1311ed06643f72541d5f3366d83bbdad80029ed0dcfcc8ef` |

## Validation

`test/cargo-acceptance.test.ts` persists full-tree verification, complete matching-input
inventory and the native record/binding checks above. Its two case tests pass together.
The initial independent `tomllib` check also passed all native records and bindings.
The prior format-1 output was not used as a correctness oracle and no automatic snapshot
update command was used.

Reviewed candidate baseline: `test/__snapshots__/BurntSushi+ripgrep.json`, SHA-256
`2fc79ff2a0dafbf7058478344badeb7e5cda13c360f4e236fc9316901d1e081d`. Its catalog contains 82 packages, 2
graphs and no projects. This document and the matching acceptance ledger record define
the scope of acceptance; they do not claim successful Cargo execution.
