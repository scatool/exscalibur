# CLAUDE.md

## Project Overview

Excalibur extracts dependency graphs from software projects. It parses lockfiles, package manifests, and other dependency definition files to produce a normalized graph of packages, subprojects, and relationships. Output uses [Package URLs (PURLs)](https://github.com/package-url/purl-spec) as identifiers.

This is a pnpm workspace using Vite+ for install and task orchestration. All packages live under `packages/`.
Published packages, the CLI, and repository tests target Node.js.

## Commands

Run all commands from the project root unless noted otherwise.

| Task                      | Command                              | Notes                           |
| ------------------------- | ------------------------------------ | ------------------------------- |
| Install dependencies      | `vp install`                         |                                 |
| Run all checks            | `vp run -w ready`                    | Format, lint, test, build       |
| Run all unit tests        | `vp run -r test`                     | Runs package tests recursively  |
| Run tests for one package | `cd packages/<name> && vp test run`  |                                 |
| Run a single test file    | `vp test run <path>`                 |                                 |
| Update snapshots          | `vp test run <path> -u`              |                                 |
| Type check                | `vp run -r check`                    | Runs package checks recursively |
| Type check one package    | `cd packages/<name> && vp run check` |                                 |
| Build                     | `vp run -r build`                    | Emits Node-compatible `dist/`   |
| Lint                      | `vp lint`                            | Oxlint                          |
| Format                    | `vp fmt`                             | oxfmt                           |

Root `ready`, `test`, `check`, and `build` use Vite+ workspace task orchestration.

### Integration Tests

Integration tests in `test/` run all extractors against real open-source repositories pinned to exact commit SHAs (configured in `test/repositories.json`).

**Setup:**

1. Download repositories: `vp exec tsx test/scripts/download-repositories.ts`
2. Copy `test/system.example.json` to `test/system.json` and set Java/Maven paths for your system.

**Run:** `vp test run ./test/integration.test.ts`

Use the explicit file path because downloaded repositories can contain unrelated test files.

**Update snapshots:** `UPDATE_SNAPSHOTS=1 vp test run ./test/integration.test.ts`

**Pitfalls:**

- `test/repositories/` is gitignored. Do not run dependency-update tools from the project root — they may modify `package.json` files inside downloaded repos and break snapshots.
- Some downloaded repos contain their own test files; avoid broad test globs from the repository root.

### Tool Versions

The project uses `mise` to manage tool versions (see `mise.toml`):

- **pnpm** 10.24.0
- **Java** temurin-21 — required for Gradle plugin tests (Gradle 8.5 doesn't support newer JDKs)
- **Maven** 3 — required for Maven plugin tests

## Architecture

### Core Types (`@scatool/analyzer-core`)

```
AnalyzerResult
├── packages: Package[]        # { purl, evidence: string[] }
├── subprojects: Subproject[]  # { purl, definitionFile, scopes: DependencyScope[] }
├── relationships: Relationship[]  # { from, to: string[] }
└── issues: Issue[]            # { message, severity, file? }
```

Key interfaces:

- **`Extractor<Options>`** — `{ name, version: 1, extract(codebase, options?) }`. The primary interface all extractors implement.
- **`FilesExtractor<Options>`** — `{ name, version: 1, markFiles(codebase, options), extractFile?(file, options) }`. Higher-level interface used with the `filesExtractor()` helper.

### Extractor Pattern

Most extractors use the `filesExtractor()` helper, which handles file discovery, per-file error handling, result merging, and path normalization:

```typescript
export const extractor: Extractor = filesExtractor({
  name: "extractor-name",
  version: 1,
  markFiles: async function (codebase, options) {
    // Use scanAndMarkFiles() or call this.markFile(path) directly
  },
  extractFile: async (file, options) => {
    // Parse file and return an AnalyzerResult
  },
});
```

The core also exports `scanAndMarkFiles(context, codebase, globPattern, ignorePatterns)` as a convenience for the common glob-and-filter pattern.

### Utility Functions

- **`normalizeResult()`** — sorts all arrays for deterministic output
- **`mergeResults()`** — combines multiple `AnalyzerResult` objects, deduplicating packages and merging relationships
- **Map utilities** — `initializeExtractionMaps()`, `ensurePackageExists()`, `addPackageEvidence()`, `addRelationship()`, `buildResult()`, `errorResult()` for building results imperatively

### Plugins

| Package                          | Extractors                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzer-plugin-javascript`     | `bunlockExtractor`, `denoLockExtractor`, `packageJsonExtractor`, `packageLockJsonExtractor`, `pnpmLockExtractor`, `yarnBerryExtractor`, `yarnLockExtractor` |
| `analyzer-plugin-python`         | `pipfileLockExtractor`, `poetryLockExtractor`, `pdmLockExtractor`, `requirementsTxtExtractor`                                                               |
| `analyzer-plugin-uv`             | UV lockfile extractor                                                                                                                                       |
| `analyzer-plugin-go`             | `gomodExtractor`                                                                                                                                            |
| `analyzer-plugin-rust`           | `cargoLockExtractor`                                                                                                                                        |
| `analyzer-plugin-gradle`         | `gradleExtractor` (experimental, requires Java 21)                                                                                                          |
| `analyzer-plugin-maven`          | `mavenExtractor` (experimental)                                                                                                                             |
| `analyzer-plugin-containers`     | `dockerfileExtractor`                                                                                                                                       |
| `analyzer-plugin-github-actions` | GitHub Actions workflow extractor                                                                                                                           |
| `analyzer-plugin-cdx`            | CycloneDX SBOM parser                                                                                                                                       |
| `analyzer-plugin-ort`            | ORT analyzer result converter                                                                                                                               |
| `analyzer-plugin-conan`          | Conan package manager extractor                                                                                                                             |
| `analyzer-plugin-vcpkg`          | vcpkg package manager extractor                                                                                                                             |

Supporting packages: `analyzer-cli` (CLI entry point), `analyzer-test-utils` (shared test helpers).

### Testing

Tests use Vitest with snapshot testing. Each extractor package has:

- `__fixtures__/` — real-world example files
- `__snapshots__/` — expected output snapshots
