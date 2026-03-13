# CLAUDE.md

## Project Overview

Excalibur extracts dependency graphs from software projects. It parses lockfiles, package manifests, and other dependency definition files to produce a normalized graph of packages, subprojects, and relationships. Output uses [Package URLs (PURLs)](https://github.com/package-url/purl-spec) as identifiers.

This is a Bun monorepo managed with Turbo. All packages live under `packages/`.

## Commands

Run all commands from the project root unless noted otherwise.

| Task                      | Command                                            | Notes                          |
| ------------------------- | -------------------------------------------------- | ------------------------------ |
| Install dependencies      | `bun install`                                      |                                |
| Run all unit tests        | `bun run test`                                     | Uses Turbo across all packages |
| Run tests for one package | `cd packages/<name> && bun test`                   |                                |
| Run a single test file    | `bun test <path>`                                  |                                |
| Update snapshots          | `bun test <path> --update-snapshots`               |                                |
| Type check                | `bun run typecheck`                                | Uses Turbo                     |
| Type check one package    | `cd packages/<name> && bunx tsc --strict --noEmit` |                                |
| Lint                      | `bun run lint`                                     | ESLint                         |
| Format                    | `bun run format`                                   | oxfmt                          |

**Do not** run bare `bun test` from root — it will match test files inside downloaded fixture repositories.

### Integration Tests

Integration tests in `test/` run all extractors against real open-source repositories pinned to exact commit SHAs (configured in `test/repositories.json`).

**Setup:**

1. Download repositories: `bun test/scripts/download-repositories.ts`
2. Copy `test/system.example.json` to `test/system.json` and set Java/Maven paths for your system.

**Run:** `cd test && bun test ./integration.test.ts`

Always use the `./` prefix — without it, bun treats the argument as a pattern and picks up unrelated `.test.ts` files from downloaded repositories.

**Update snapshots:** `cd test && UPDATE_SNAPSHOTS=1 bun test ./integration.test.ts`

**Pitfalls:**

- `test/repositories/` is gitignored. Do not run tools like `bunx taze` from the project root — they will modify `package.json` files inside downloaded repos and break snapshots.
- Some downloaded repos contain their own `.test.ts` files that bun may match. These errors are not real failures.

### Tool Versions

The project uses `mise` to manage tool versions (see `mise.toml`):

- **Bun** 1.3.9 (package.json declares 1.3.10)
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
  name: 'extractor-name',
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

Supporting packages: `analyzer-cli` (CLI entry point), `analyzer-test-utils` (shared test helpers).

### Testing

Tests use Bun's test runner with snapshot testing. Each extractor package has:

- `__fixtures__/` — real-world example files
- `__snapshots__/` — expected output snapshots
