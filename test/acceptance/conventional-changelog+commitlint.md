# conventional-changelog/commitlint native format 2 acceptance

Pinned commit `803c05b6d722676ed499585ed713d185d1670462`, Git tree `d45ba012661366cf805e067d8b110c03101012fe`, source archive SHA-256 `41d6bb3e79fef342a193408b4af1177481e9c3f55da1dd0133222bac79d5ded7`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 105 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

Existing discovery excludes 65 nested manifests: 9 unnamed fixture manifest, 56 named nonworkspace manifest. Each excluded path is listed and hashed in the inventory. Ancestor lockfile discovery selects its native workspace/importer projects and suppresses standalone descendants. These exclusions preserve existing behavior; this acceptance does not claim dependency coverage for those manifests. Malformed unselected fixtures do not produce invented parsing failures.

All 16 configured integration extractors ran with namespace `integration:conventional-changelog/commitlint@803c05b6d722676ed499585ed713d185d1670462` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 3 graphs, 39 projects, 1134 catalog identities and 4424 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: 1 yarn.raw_lock_projection. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.
