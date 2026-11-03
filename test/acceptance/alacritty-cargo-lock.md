# alacritty/alacritty format 2 acceptance

The complete pinned source of `alacritty/alacritty` at `08134af8533556034272a884e40c0aaf6bf6f930` was recovered
using explicit Git transport. The fetched commit was checked against the configured
pin. Independent Git blob/tree reconstruction over all 337 files, executable modes
and symlink contents reproduced tree `89a7c899e31e344a56cf803f34ab8184272e787a`.
The source receipt records archive SHA-256
`8fa873d6a84cf33a469f5322948cd0376ed9c083137e69cedc00ee4fc4b24cae`.

## Discovery and execution

All file paths in the verified tree were inspected against the 16 extractor input
patterns in `test/integration.test.ts`. Only the Cargo lockfiles listed below match.
The Cargo manifests listed in the input hash table were inspected as context but the
configured lockfile extractor does not consume them or infer workspace roots from
them. No matching JavaScript, Go, Gradle, Python, Conan or vcpkg input was found.
Other source files and workflows do not expand the configured extractor scope.

All 16 configured extractors executed with namespace
`integration:alacritty/alacritty@08134af8533556034272a884e40c0aaf6bf6f930` using Node.js 22.23.4,
pnpm 10.24.0 and Vite+ 1.3.0. `cargolock` produced 1 observations;
the other 15 extractors produced empty results with no issues. Every nonempty
observation reports the expected `cargo.raw_lock_projection` HINT. No WARNING or
ERROR occurred. Results were merged and normalized with the core format/reference
validator. No Cargo executable, metadata command, registry request or native build
was run. Independent initial comparison used Python's `tomllib`; persisted assertions
use a separate strict parser for the small TOML subset present in these exact locks.
Neither comparison imports the production Cargo converter or identity helpers.

## Native records and boundaries

| Input        | Package records | Native dependency references | Source-less records |
| ------------ | --------------: | ---------------------------: | ------------------: |
| `Cargo.lock` |             292 |                          707 |                   4 |

All 292 native package records and 707 dependency references match
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

The root manifest is a workspace declaring four members. Its existence does not
establish per-member scopes or feature selection from the lock alone. The baseline
retains all 292 records and 707 bindings as one independent raw lock observation.

## Input hashes

| File                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `Cargo.lock`                         | `64fe1daf7dfcfdd94731c7c1e66233d68df72b240753876aa2250bc8d701b75e` |
| `Cargo.toml`                         | `78aaef58037bec9e072df833f289d3cbef0c46a51255210c532ed1c0178e759e` |
| `alacritty/Cargo.toml`               | `d715ec56b94c9105183325a5142b47d398c58e4b1ee117941c909c520144eb2f` |
| `alacritty_config/Cargo.toml`        | `24517b5567f9026fdc0b9d3bf42ac3d0f9ea3473219bc304ba387bc12d1a4788` |
| `alacritty_config_derive/Cargo.toml` | `ed428391b16633a4f0f69a661701125bec852c72d0e7adfccb9f3efef5f4e523` |
| `alacritty_terminal/Cargo.toml`      | `15017ac4eda6f871c12e0e61a1c557f19c293dffeb5a6c63fc0ac3ce33013519` |

## Validation

`test/cargo-acceptance.test.ts` persists full-tree verification, complete matching-input
inventory and the native record/binding checks above. Its two case tests pass together.
The initial independent `tomllib` check also passed all native records and bindings.
The prior format-1 output was not used as a correctness oracle and no automatic snapshot
update command was used.

Reviewed candidate baseline: `test/__snapshots__/alacritty+alacritty.json`, SHA-256
`eabee08d82557d0f5ae5e89842a9acb651583cb173fbbf04b650efc06fc02234`. Its catalog contains 292 packages, 1
graphs and no projects. This document and the matching acceptance ledger record define
the scope of acceptance; they do not claim successful Cargo execution.
