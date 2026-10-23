# @scatool/analyzer-plugin-rust

**Note**: This plugin is experimental.

Rust (Cargo) dependency analyzer plugin for Exscalibur.

## Requirements

- `Cargo.lock` file must be present in the project
- Exported `cargo-metadata.json` is needed to import workspace membership and scopes

No external tools (Cargo, Rust) are required during extraction: the plugin parses
lockfiles or previously exported metadata. Generating metadata requires Cargo.

## Usage

```typescript
import { cargoLockExtractor } from "@scatool/analyzer-plugin-rust";

const result = await cargoLockExtractor.extract("/path/to/codebase");
```

## Native result v2

All extractors return `formatVersion: 2`, keeping source identity and native graph
references separate. Every component and project has a PURL. `cargoLockExtractor`,
`cargoMetadataExtractor` and the CLI use this format; the `V2` extractor names remain
aliases for the same implementations.

```typescript
import { cargoLockExtractor, convertCargoMetadataV2 } from "@scatool/analyzer-plugin-rust";

const inventory = await cargoLockExtractor.extract("/path/to/codebase");
const result = convertCargoMetadataV2(nativeMetadata, {
  codebase: "https://github.com/example/project@exact-revision",
  evidenceFile: "cargo-metadata.json",
  definitionFilePrefix: "", // Explicitly map the exported workspace root to this codebase root.
  toolVersion: "1.90.0",
  context: { "cargo:invocation": { formatVersion: 1, offline: true, locked: true } },
});
```

Generate metadata with `cargo metadata --format-version 1` and record the actual
feature/platform flags with its inputs. `cargoMetadataExtractor` imports files
named `cargo-metadata.json`; it does not execute Cargo. Import options include
`definitionFilePrefix`, `context` and `toolVersion`.

Cargo metadata produces independent package-membership and manifest-declaration
graphs. Membership roots use the explicit aggregate scope `cargo:metadata`, including
reported development dependencies. This scope does not claim a production or runtime
closure. Declared roots retain `dependencies`, `dev-dependencies` and
`build-dependencies`, optional activation, original reported requirements and requested
features. A `--no-deps` result retains unknown resolved coverage.

Native package IDs stay opaque. Only `workspace_members` establishes workspace
project ownership. Without an explicit path mapping, imported subjects refer to the
metadata file and retain their native manifest identity; exports from different
workspaces do not silently become one source project.

Metadata is not Cargo's compilation-unit graph. Its package-level feature sets stay
in native attributes, and target predicates retain their declaring compilation-domain
uncertainty. A package admitted by `--filter-platform` can still list several target
predicates. Recorded membership does not establish that every listed predicate is
active. Separate host/target feature variants require additional native unit evidence.

The lock adapter supports versionless legacy records and explicit formats 1–4. It
retains native source distinctions, checksums, replacement directives and unused patch
inventory. Except for legacy `[root]`, locks do not establish project entry points;
source-less entries are local packages with unknown paths and membership. Kinds,
targets, requested features and activated features are not reconstructed from locks.

Identity policy is explicit: crates.io uses ordinary Cargo PURLs; other registry/Git
sources use the source-distinguishing `cargo_source` qualifier, an Excalibur convention.
Local packages use synthesized generic PURLs scoped by their known manifest identity
or, when unknown, their lock observation. Checksums are artifact observations.

Fixture tests compare native lock records and dependency references with graph
records and edges. Validation also uses captured Cargo metadata, independent
raw-record comparisons and exact upstream input hashes. See the
[result v2 contract](../analyzer-core/src/result-v2/README.md).
