# Exscalibur

Exscalibur extracts dependency graphs from software projects.

> **Status:** Exscalibur is under active development. Breaking changes may be introduced in any minor release.

## Related Tools

- [OSS Review Toolkit](https://github.com/oss-review-toolkit/ort) (Apache-2.0)
- [OSV-SCALIBR](https://github.com/google/osv-scalibr) (Apache-2.0)
- [Syft](https://github.com/anchore/syft) (Apache-2.0)
- [cdxgen](https://github.com/CycloneDX/cdxgen) (Apache-2.0)
- [BlackDuck Detect](https://github.com/blackducksoftware/detect) (Apache-2.0)
- [FOSSA CLI](https://github.com/fossas/fossa-cli) (CPAL-1.0)
- ...and many more

## Development

The [analyzer result v2 contract](packages/analyzer-core/src/result-v2/README.md)
describes the opt-in model for context-preserving dependency graphs, its reviewed
alternatives and current migration status. The CLI still emits the existing format.

Exscalibur is a [pnpm](https://pnpm.io/) workspace using [Vite+](https://viteplus.dev/) for install and task orchestration.
Each extractor lives in its own package under `packages/`.
Published packages, the CLI, and repository tests run on Node.js.

### Getting Started

Install dependencies from the repository root:

```sh
vp install
```

Before pushing changes, make sure the codebase still passes all checks:

```sh
vp run -w ready
```

`ready` runs `vp fmt`, `vp lint`, recursive package tests, and recursive package builds in that order.

### Unit Tests

Unit tests run with Vitest and mostly rely on snapshot testing.
Each extractor package keeps its fixtures in `__fixtures__/` and expected output in `__snapshots__/`.

Run the full suite from the repository root:

```sh
vp run -r test
```

> **Note:** `vp run -r test` runs each package test script recursively through the workspace.

To work on a single package, `cd` into it and run `vp test run` directly.
To run a single test file, use `vp test run <path>`.

### Integration Tests

Integration tests run every extractor against real open-source repositories pinned to exact commit SHAs (see `test/repositories.json`). They live in `test/` and are also snapshot-based.

Some extractors require specific tool versions (for example Java 21 for Gradle, Maven 3, etc.).
The expected versions are declared in `mise.toml`. The easiest way to get them is:

```sh
mise install
```

Alternatively, install the tools manually.

Once the tools are available, copy the example system config and point it at the binaries on your machine:

```sh
cp test/system.example.json test/system.json
# then edit test/system.json
```

All remaining commands are run from the repository root.
First, download the fixture repositories (only needed once):

```sh
vp exec tsx test/scripts/download-repositories.ts
```

Then run the integration tests:

```sh
vp test run ./test/integration.test.ts
```

The explicit file path is important because downloaded repositories can contain unrelated test files.

To refresh the snapshots after intentional changes:

```sh
UPDATE_SNAPSHOTS=1 vp test run ./test/integration.test.ts
```
