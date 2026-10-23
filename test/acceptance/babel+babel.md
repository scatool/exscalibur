# babel/babel native format 2 acceptance

Pinned commit `4cc3d8888f3e3ac30d38ccfa4557baa7a4a52714`, Git tree `ec7d26d9baa6f42d03a5570ff35949d1562590e8`, source archive SHA-256 `1e8f32b0826800ca8fdc5bba945a71184090671e8757d4948b2b1ff555e8f044`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 224 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

Existing discovery excludes 50 nested manifests: 46 unnamed fixture manifest, 2 malformed fixture, 2 named nonworkspace manifest. Each excluded path is listed and hashed in the inventory. Ancestor lockfile discovery selects its native workspace/importer projects and suppresses standalone descendants. These exclusions preserve existing behavior; this acceptance does not claim dependency coverage for those manifests. Malformed unselected fixtures do not produce invented parsing failures.

All 16 configured integration extractors ran with namespace `integration:babel/babel@4cc3d8888f3e3ac30d38ccfa4557baa7a4a52714` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 3 graphs, 173 projects, 1600 catalog identities and 12482 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: 18 npm.unresolved_dependency, 2 yarn.manifest_lock_mismatch, 1 yarn.raw_lock_projection. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.
