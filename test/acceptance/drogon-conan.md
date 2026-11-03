# Drogon native Conan graph acceptance

Reviewed superproject commit `9784c612762b106adf70a713cf68384d909d2141`
(`drogonframework/drogon`), tree `f2262e446fadf4e7b4830be823678366c73ae6a3`.
The repository downloader acquired the pinned GitHub archive, SHA-256
`c6ad8eb7d772ef94a96fb07e69340c2e3c8119f66ff850aa2fdd977ae5c38494`.
The commit-to-tree association was verified through GitHub's Git commit API.
The archive omits `trantor` gitlink `63a4e5e164e219dc3bf30cdbfa1462ae5602fa97`;
this review makes no claim about recursive submodule contents.

## Native observation

Used the repository-declared Conan 2.28.1, installed with mise, and the unchanged
build and host profile in `packages/analyzer-plugin-conan/src/__fixtures__/profile`.
The case's existing `--build '*'` arguments were retained. From `test/`, the command
was `conan graph info repositories/drogonframework+drogon/conanfile.txt --format json
--profile:build ../packages/analyzer-plugin-conan/src/__fixtures__/profile
--profile:host ../packages/analyzer-plugin-conan/src/__fixtures__/profile --build '*'`.

`conan graph info` succeeded with no graph error. The profile requests Linux x86_64,
GCC 15, gnu17, libstdc++11 and Release; it is a resolution input, not a statement
that this executor's GCC 14 compiled the packages. All seven package selections
have `binary=Build`: no compilation or installation was performed.

`conan-native-drogon.json` preserves the native root, graph error, resolution maps,
and node identity, recipe revision, context, package ID, binary status, settings,
options and complete dependency records. Local cache paths, unrelated recipe
metadata and timestamps are omitted. It is evidence captured from Conan, not a
conversion of the analyzer baseline.

## Source and semantic comparison

The superproject's only matching extractor input is `conanfile.txt`. Its seven
ordinary requirements are jsoncpp/1.9.4, zlib/1.2.11, gtest/1.10.0,
sqlite3/3.40.1, openssl/1.1.1t, hiredis/1.0.0 and brotli/1.0.9.
The commented libpq entry is excluded. Each resolves to exactly one host node,
with its selected recipe revision and package ID retained. Native package nodes
have empty dependency maps for this observation.

The accepted V2 baseline has seven catalog packages, one synthesized subject at
`conanfile.txt#node=0`, one graph, eleven contextual views and fourteen edges.
The consumer and runtime scope each retain seven direct selected edges. Build
and test roots are empty. GTest remains an ordinary requirement because the source
does not declare it as a test requirement. The graph's `runtime` scope is the
analyzer's grouping of ordinary requirements: it does not override Conan's retained
`run=false`, `libs=true` and `headers=true` traits. Queries report complete dependency
coverage for this captured graph; this does not establish installed runtime closure.

All sixteen existing integration extractors were run with the stable integration
namespace and unchanged case options. Only Conan contributed output, with no
issues. Core validation and an independent reviewer checked catalog identities,
root membership, native settings/options/traits, direct adjacency and conservative
query results. `test/conan-acceptance.test.ts` makes these source comparisons
executable, separately from the integration baseline equality check.

Recipe versions do not pin recipe revisions. Future ConanCenter revision changes
can legitimately change selected hashes, settings or options; a baseline mismatch
must be investigated and reviewed rather than automatically updated.
