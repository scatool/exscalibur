# Offline npm workspace, link and alias oracle

This development oracle generates npm lock versions 1, 2 and 3 from the same tiny authored workspace. It does not change production scanning: extraction remains a read of source files, with no npm invocation, package installation, scripts, registry access or source mutation.

Use Node 22.23.4 with an explicit npm 11.9.0 installation containing Arborist 9.2.0, plus the repository’s pinned Vite+ formatter (Oxfmt 0.73.0) on `PATH`:

```sh
node packages/analyzer-plugin-javascript/src/packagelockjson/npm-workspace-oracle.mjs "$NPM_ROOT" packages/analyzer-plugin-javascript/src/packagelockjson/__fixtures__/npm-workspace-oracle
```

The source contains two workspaces (`workspace-app` and `workspace-lib`), a local directory dependency (`local-link`), and an alias `renamed` for `real-leaf@1.0.0`. All manifests are recorded in the report. To exercise native alias resolution offline, the generator explicitly supplies one authored package metadata document through Arborist's `packumentCache` option. Its tarball is packed from the authored manifest and seeded into the isolated content cache by integrity. This is controlled metadata, not a response observed from any registry. Native Arborist still performs resolution, creates links, installs that cached tarball, and generates each lockfile; no lock entries or resolved placements are hand-authored.

The test-only installation runs with `offline` and `ignoreScripts`, no audit, and an unreachable loopback registry. Only a temporary source tree/cache and the requested output directory are written. Temporary data is cleaned up. Absolute temporary workspace references in captured edge specifications are replaced by `<project>`; manifests are formatted before native operations; generated locks retain npm’s original bytes (Oxfmt excludes lockfiles). The formatter changes JSON presentation only. Captured input hashes therefore match the actual formatted bytes supplied to the native virtual reader and checked in as fixtures. The report records the formatter version; regeneration uses repository formatting configuration.

For each lock version, the generator records the native actual tree before mutation, removes `node_modules`, and captures read-only `loadVirtual()` results for three cases:

- Current workspace manifests.
- Missing app workspace manifest, retaining its frozen lock entry.
- Stale app workspace manifest with the alias declaration removed, retaining its frozen lock entry.

All nine native virtual reads succeed. The alias's placement name remains `renamed`, while its package identity is `real-leaf@1.0.0`. Native links retain their distinct target locations. When the app manifest is missing, native root workspace membership omits that app but its locked node and outgoing requests remain. With the stale app manifest, native virtual outgoing requests reflect its current declarations instead. Consequently, the raw locked graph is compared with the pre-mutation native installation; the current virtual graph is a separate observation and is not used to overwrite locked requests.

Versions 2 and 3 supply independent project records. The extractor retains exact project/scope roots, resolves local and workspace links to contextual project consumers, retains alias package identity, and separates stale current-manifest declarations. When a manifest is absent, the corresponding subject uses its lock-record definition rather than claiming a current file exists.

Version 1 stores local `file:` references in its dependency tree but does not independently record all workspace project scopes. The oracle exposed complete root enumeration despite omitted workspace/local project scopes. The regression requires unknown root completeness for this unsupported v1 enumeration; it does not infer project identities or add a resolver. One `npm.legacy_local_context_unknown` warning records this limitation. Local directory records without resolved artifacts retain unknown adjacency, and their outgoing requests retain unknown selection with candidate targets. This avoids treating synthetic v1 placement as proven source-relative resolution. Registry alias records and their known metadata remain unaffected.

The tests verify source hashes and native package/link/alias observations, then compare scoped source requests and graph-local targets directly with captured native edges. Reproduction requires the pinned native tools; the ordinary regression tests consume checked-in evidence and do not install anything.
