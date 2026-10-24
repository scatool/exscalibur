# Integration baseline acceptance

[integration-migration.json](./integration-migration.json) tracks each case in
[repositories.json](./repositories.json) by repository and exact commit. It records
historical baseline hashes, local input checkpoints, configured tool requirements,
and separately inferred native-tool use. It is an acceptance inventory, not a new
expected result and not proof that a repository was successfully extracted.

The inventory contains **87 cases: 87 accepted and 0 pending source review**. Reviewed cases carry an accepted format 2 hash
and source evidence; all other cases remain explicitly pending. The original inventory
contained 87 legacy baselines, of which eleven contained historical issues;
those issues must be investigated rather than copied into new expected output.
A local directory or nonempty extraction result does not establish source provenance.
A `receipt-recorded` checkpoint means the pinned archive was acquired; it does not
claim current tree integrity or semantic review. The input checkpoint can change
as repositories are restored; acceptance requires
review evidence recorded independently of that checkpoint.

## Requirements and evidence

Every harness run uses Node 22, pnpm 10.24.0 and the pinned Vite+ workspace tools.
Parsing npm, pnpm, Yarn, Bun, Cargo locks and Python metadata does not by itself
require those package managers to execute. Yarn lockfile paths alone cannot identify
Classic versus Berry. The current integration harness includes 16 existing
extractors; Maven, UV, Deno, Dockerfile, GitHub Actions, ORT and the SBOM importers
have separate package tests and are not silently added to this 87-case inventory.

The only explicitly configured JVM switch is Java 11 for `evorto/wahlzeit`.
`rustdesk/rustdesk` configures Gradle ignore patterns, which is not evidence that
Gradle executes. `drogonframework/drogon` configures Conan build/host profiles and
command arguments. Each entry preserves these options verbatim.

Historical baseline input paths suggest native-tool work for eight cases:

| Case                     | Inferred native tools                 | Historical input evidence                                            |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `ory/kratos`             | Go 1.26.3                             | Eight `go.mod` paths                                                 |
| `sharkdp/bat`            | Go 1.26.3                             | Two syntax-test `go.mod` paths, including a historical parse failure |
| `ZEISS/htmx-template`    | Go 1.26.3                             | Root and `tools/go.mod`                                              |
| `evorto/wahlzeit`        | Java 11 and repository Gradle wrapper | `build.gradle`; Java 11 is also explicitly configured                |
| `Corvusoft/restbed`      | vcpkg 2026.04.27                      | Root `vcpkg.json`                                                    |
| `microsoft/terminal`     | vcpkg 2026.04.27                      | Root and overlay-port `vcpkg.json`                                   |
| `rustdesk/rustdesk`      | vcpkg 2026.04.27                      | Root and six port `vcpkg.json` files                                 |
| `drogonframework/drogon` | Conan 2.28.1                          | `conanfile.txt`, with configured profiles                            |

Tool versions come from `mise.toml`, the explicit case JVM setting, or the integration
workflow's pinned vcpkg checkout. Each inferred entry includes its exact historical
paths and the baseline fields supporting the inference. These are possible tool
requirements, not assertions that tools ran successfully. The other 79 cases lack
historical native-tool evidence; this does **not** prove that their pinned source
contains no additional matching inputs.

## Review sequence

1. Restore the exact pinned source through an authorized route and record its
   revision or archive identity plus relevant input hashes. An incomplete archive,
   `.gitkeep` directory, or subset copied from another revision is insufficient.
2. Inspect all matching inputs and the configured ignore patterns. Resolve which
   native tools actually execute, record versions and command options, and preserve
   failures as failures. Do not retry denied services or weaken checks to obtain a
   passing result.
3. Run the native V2 extractors with the harness's stable codebase namespace.
   Validate the wire contract and graph references. Independently compare native
   declarations, catalog identities, exact project/scope roots, bindings, conditions,
   contextual views and unknown coverage. A valid schema is not semantic acceptance.
4. Review the resulting format 2 baseline against those inputs. Record its hash,
   source evidence and executed checks in the case's `reviewEvidence`. Mark the case
   `accepted` only after that review; update the inventory summary from case states.
5. Run the explicit integration test for the accepted case. Preserve the harness's
   comparison gate: missing or legacy expected data must fail, and normal runs must
   never create or update expected output automatically.

Legacy relationships and scopes cannot recover contextual views or source selection.
There is no semantic translation from a legacy baseline to an accepted V2 baseline.
Legacy JSON remains reference material until its case has a reviewed replacement.
No baseline is accepted merely because the old catalog and a new catalog overlap.

## Review coverage

Accepted cases include manifest-only repositories, npm/Yarn/pnpm/Bun observations,
Cargo lock records, Python declarations and lock membership, and native Go and
vcpkg metadata. Each case's review document states the inspected inputs, excluded
or unavailable scope, preserved issues and executed assertions. Acceptance does
not imply successful installation or complete effective runtime resolution.

All 87 cases have reviewed format 2 baselines. Wahlzeit uses its pinned Gradle 6.6.1
wrapper and Java 11; exact repeated native records are collapsed without merging
conflicting facts. See `acceptance/wahlzeit-gradle.md` and
`gradle-acceptance.test.ts`. Drogon's native Conan 2.28.1 review is documented in
`acceptance/drogon-conan.md` and `conan-acceptance.test.ts`.
Acceptance preserves each extractor's documented coverage limits; it does not
claim variant-complete Gradle resolution or actual Conan package compilation.

Existing local package fixtures provide narrower, immediately inspectable checks:
JavaScript manifest/lock fixtures, Python requirements/pyproject/Pipfile/Poetry/PDM
fixtures, Cargo locks, and the captured Cargo metadata inputs under
`packages/analyzer-plugin-rust/src/metadata/__fixtures__/cargo-1.90.0`.
Synthetic native-response tests exercise Go/Maven/Gradle/Conan/vcpkg model cases.
These are useful supporting checks but do not replace any of the 87 pinned
repository baselines or establish end-to-end resolver acceptance.

## Executable acceptance gate

`integration-acceptance.ts` checks exact coverage of `repositories.json`, its file
hash, repository pins, extractor options and configured Java versions. Pending
cases fail with their tracked status before invoking extractors. Accepted cases
require a separate `baseline.acceptedSha256`, a source commit/tree/archive receipt,
input hashes, tool versions, semantic assertions and a hashed review document.
`baseline.sha256` always remains the historical baseline hash. The harness checks
the reviewed baseline, stable codebase namespace and current input hashes; it never
writes baselines. Merely adding `formatVersion: 2` to legacy data cannot pass core
validation or the independent source assertions.

Run `vp test run test/integration-acceptance.test.ts` with restored accepted sources
for reproducible manifest declaration and query checks, including exact manifest-to-graph
coverage for reviewed workspaces. Run
`vp test run test/demo-acceptance.test.ts` for the reviewed shrinkwrap topology
and conservative root-correlation checks. `vp test run test/cargo-acceptance.test.ts`
compares reviewed Cargo lock records and source/version bindings; it does not run
Cargo or infer effective workspace features. `test/python-acceptance.test.ts`
compares native Python records, declarations and conservative group queries.
`test/javascript-fixtures-acceptance.test.ts` and `test/zeiss-acceptance.test.ts` cover reviewed
manifest fixtures, npm placements and Yarn descriptor observations, including
expected malformed-input errors and manifest drift. Each is run with
`vp test run <test-file>`; missing pinned inputs fail explicitly. Missing or changed source
files fail explicitly. Run selected end-to-end cases with
`vp test run test/integration.test.ts -t '<case>'`. Review notes are in `acceptance/`.
A source receipt records acquisition; by itself it does not prove cached files
remain unchanged after native tools execute.

For native-tool cases, provision pinned tools through the repository's existing
`mise.toml` and workflow setup. Set real Java locations in `test/system.json`,
including Java 11 where the case explicitly requests it. Use writable normal tool
caches (`GRADLE_USER_HOME`, `GOCACHE`, `GOMODCACHE`, `GOPATH`); changing a cache path
does not satisfy missing downloads. Gradle fixture wrappers require access to their
configured distribution host (`services.gradle.org` for Gradle 8.5 fixtures).
Native Conan resolution needs its configured registry; vcpkg requires the pinned
checkout and normal bootstrap. Preserve network/tool errors and unknown coverage;
do not substitute empty successful output when prerequisites are unavailable.

Summary counts are validated against case states on every run; historical baseline
counts are not expected package or graph counts for the new format.

For `pypa/pipenv`, reviewed input is the superproject archive. Eight gitlink commits
are recorded in its hashed acceptance document, and `.gitmodules` is included in
source hashes. Submodule contents were not acquired or analyzed; acceptance must
not be interpreted as recursive source coverage.

Mixed JavaScript repositories also have dedicated assertions in
`test/javascript-workspaces-acceptance.test.ts`, `test/javascript-lockfiles-acceptance.test.ts` and
`test/mixed-workspaces-acceptance.test.ts`. These compare source records and graph-local
bindings, artifacts, applicability predicates and workspace declarations. Calcom's
binary Bun input remains an explicit unsupported-input ERROR with an unknown
observation; accepting that baseline validates preservation of the limitation,
not successful binary-lock extraction. Xtuc's review is limited to the superproject
archive; its omitted `testsuite` gitlink is recorded in the hashed review document.

`test/go-acceptance.test.ts` compares captured selected-module output with the
native Go graph, including replacements, original requests and owner adjacency.
The reviewed Go cases used Go 1.26.3 with checksum verification enabled. Tool cache
locations are execution details and are not serialized as stable package facts.
Bat's acceptance covers its superproject archive: 91 gitlink SHAs are recorded in
the hashed review document, and nested submodule inputs are not claimed as analyzed.
Its ANSI-highlighted malformed Go and requirements fixtures retain their errors.

`test/vcpkg-acceptance.test.ts` compares captured native package metadata against
manifest requests, host/target contexts and conservative candidate selection. The
reviewed runs used the repository's pinned registry checkout and verified native
tool. Native metadata observations are not installed dependency closures; version
override mismatches remain uncertain, and configured exclusions stay explicit.
