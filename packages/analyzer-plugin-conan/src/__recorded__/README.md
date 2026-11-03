# Recorded Conan fixture commands

These recordings retain the complete stdout, stderr and exit code from Conan
2.28.1 `graph info` for the five existing package fixtures. `provenance.json`
records each exact command's source inputs and SHA-256 hashes. The command itself
is stored with the recording. The recipes, lockfiles and host/build profile were
not changed. The captures were made on 2026-10-25 at analyzer commit
`f1992774b33e574ea1c41f5fa68f7ad1c79196cc`.

`recorded.test.ts` replays these responses through the actual extractor and
compares its complete current-format result. It verifies every recording/input
hash, the command invocation, direct native adjacency, and the unchanged warning
text before comparing the snapshot. The two profile arguments use the stable
`__fixtures__/profile` token in the test's graph context; the profile's actual
contents are hash-verified. The captured command and native output retain their
original absolute paths. No native output fields are removed or rewritten.

The original live command tests in `index.test.ts` remain unchanged. They still
exercise the installed Conan tool and check the native graph independently.
The replay snapshots are not a claim that live native output is byte-identical
across machines or cache states. Conan's output records recipe-cache activity,
binary availability/revisions and absolute source paths. These recordings were
captured with the fixture recipes already present in the cache and retain the
reported `Missing`, `Download` and `Skip` states and any warnings. A cold cache or
later remote binary publication can legitimately produce different output.

To refresh a recording, run the recorded `conan graph info` command with the
matching Conan version, pinned lock and profile. Review native nodes, direct
edges, host/build settings, revisions and diagnostics against those inputs before
updating the provenance hashes and full-output snapshot. Do not copy a new
snapshot without reviewing the native response that produced it.
