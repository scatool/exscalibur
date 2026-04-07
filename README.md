# Excalibur

Excalibur extracts dependency graphs from software projects.

## Development

Excalibur is a [Bun](https://bun.sh) monorepo managed with [Turbo](https://turbo.build).
Each extractor lives in its own package under `packages/`.

### Getting Started

Install dependencies from the repository root:

```sh
bun install
```

Before pushing changes, make sure the codebase still passes all checks:

```sh
bun run format:check
bun run typecheck
bun run lint
```

### Unit Tests

Unit tests run with Bun's test runner and mostly rely on snapshot testing.
Each extractor package keeps its fixtures in `__fixtures__/` and expected output in `__snapshots__/`.

Run the full suite from the repository root:

```sh
bun run test
```

> **Note:** Always use `bun run test` (which goes through Turbo) rather than a bare `bun test`.
> The latter will pick up `.test.ts` files inside downloaded fixture repositories and fail.

To work on a single package, `cd` into it and run `bun test` directly.

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
bun test/scripts/download-repositories.ts
```

Then run the integration tests:

```sh
bun test ./test/integration.test.ts
```

The `./` prefix is important — without it, Bun treats the argument as a glob and picks up unrelated test files from inside the downloaded repositories.

To refresh the snapshots after intentional changes:

```sh
UPDATE_SNAPSHOTS=1 bun test ./test/integration.test.ts
```

## Related Tools

- [OSS Review Toolkit](https://github.com/oss-review-toolkit/ort) (Apache-2.0)
- [OSV-SCALIBR](https://github.com/google/osv-scalibr) (Apache-2.0)
- [Syft](https://github.com/anchore/syft) (Apache-2.0)
- [cdxgen](https://github.com/CycloneDX/cdxgen) (Apache-2.0)
- [BlackDuck Detect](https://github.com/blackducksoftware/detect) (Apache-2.0)
- [FOSSA CLI](https://github.com/fossas/fossa-cli) (CPAL-1.0)
- ...and many more
