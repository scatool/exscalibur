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
defines the sole model for contextual dependency graphs. Library defaults and the
CLI emit `formatVersion: 2`; legacy result objects and PURL-union helpers are removed.
The extractor interface version remains independent of the result format.

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

`ready` runs formatting, recursive builds, lint and recursive package tests.
Run `vp run -r check` separately for all workspace type checks.

### Unit Tests

Unit tests run with Vitest. Fixtures in `__fixtures__/` are checked against explicit
native record/declaration expectations and the core validator. A valid error result
is not accepted as successful extraction.

Run the full suite from the repository root:

```sh
vp run -r test
```

> **Note:** `vp run -r test` runs each package test script recursively through the workspace.

To work on a single package, `cd` into it and run `vp test run` directly.
To run a single test file, use `vp test run <path>`.

### Integration Tests

Integration tests run the configured extractors against repositories pinned to exact
commit SHAs (`test/repositories.json`) and compare complete format 2 results against
reviewed baselines. All 87 configured cases have accepted format 2 baselines;
[the acceptance inventory](test/INTEGRATION_ACCEPTANCE.md) retains their historical
baseline hashes and source-review evidence. The harness verifies acceptance and
never silently creates or updates a baseline.

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

Baseline changes require inspecting native declarations, selected records, graph contexts,
coverage and extractor issues against the pinned inputs. Do not bulk-regenerate legacy
baselines or treat structural validation as native correctness evidence.
