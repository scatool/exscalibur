# FormidableLabs/victory native format 2 acceptance

Pinned commit `4aafb3d4839110c261a07f8dd10e52ce57716c33`, Git tree `4c06435a9e4cf2fc81d0a60381ca850abd77ead8`, source archive SHA-256 `bf13e28ba96480640cc629e02b150eded777e6cff5f91625b90e6d1e3cd59fe3`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 34 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

All 16 configured integration extractors ran with namespace `integration:FormidableLabs/victory@4aafb3d4839110c261a07f8dd10e52ce57716c33` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 2 graphs, 33 projects, 2648 catalog identities and 8317 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: none. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.
