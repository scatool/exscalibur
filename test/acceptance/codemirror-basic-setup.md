# Codemirror basic-setup format 2 acceptance

The baseline covers the complete source tree of `codemirror/basic-setup` at commit
`76462c05acb10fe77e0f04edd7fcddfeb9987abd`. Git tree identity was independently
recomputed from all nine source files, their modes and directory structure:
`023306729652ff5e5deebba7aa925c923bd4d0be`. The restoration-only `.gitkeep` was excluded.
The source receipt records archive SHA-256
`9a933161ac4067b4e0df5bafabfd03055c37070591b8dea83dcc9d460a47017b`.

The only input matching the 16 extractors configured by `integration.test.ts` is
`package.json`, SHA-256
`1e777e57d420a78c1872334497910718e4a2bb9f9f0af4dccb716972216173eb`.
There are no lockfiles, nested package manifests, Go, Gradle, Cargo, Python, Conan
or vcpkg inputs. The tree also contains a GitHub Actions dispatch workflow; the
GitHub Actions extractor is not part of the configured integration suite and this
acceptance does not expand that suite's scope.

All 16 configured extractors were executed with codebase namespace
`integration:codemirror/basic-setup@76462c05acb10fe77e0f04edd7fcddfeb9987abd`.
Execution used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Only `packagejson`
produced an observation; the other 15 found no matching files. No extractor issues
were reported. The normalized result passed core reference and format validation.

Independent assertions compare the result directly with the native manifest:

- Project identity is `pkg:npm/codemirror@6.0.2`, described by `package.json`.
- Runtime declarations are `@codemirror/autocomplete`, `commands`, `language`,
  `lint`, `search`, `state` and `view`, each requesting `^6.0.0`.
- Development declares `@codemirror/buildhelper` with `^1.0.0`.
- All eight records are declarations with no invented target or selected version;
  selected applicability describes the declaration's presence in its scope.
- Four exact project roots represent dependencies, development, optional and peer
  scopes. Optional and peer scopes contain no declarations.
- The runtime and development closure queries return no resolved members and
  unknown resolution completeness, with seven and one declarations respectively.
  Empty optional and peer closures are complete. The consumer view independently
  retains unknown dependency completeness.
- The catalog contains no fabricated versionless packages; one project, one
  declared graph, five project views and eight declaration edges are retained.

The previous result shape was not used as a correctness oracle. No baseline was
written by the integration test. This verifies complete extraction of the pinned
repository for the configured extractors; it does not establish installed versions,
transitive runtime dependencies or successful native builds.

Accepted baseline: `test/__snapshots__/codemirror+basic-setup.json`, SHA-256
`4cb8325d33c7e81562aeba9ad5b6452d346236260642f9284cfd111ea0960331`.
