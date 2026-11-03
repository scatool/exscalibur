# cheeriojs/cheerio native format 2 acceptance

Pinned commit `14b76e8e9834f27c43022d05cdaeeae621e2e916`, Git tree `a2ed5e6ec7235fb1eb5c8f91f179eef9308f66a8`, source archive SHA-256 `7c332cf79974449dffc27458b5f53fe3718ca34acff014cdc3fd2a1c717105d1`. The complete restored tree was independently reconstructed and verified against the Git tree, including file bytes, modes and symlinks.

The tracked `javascript-workspace-sources.json` entry records all 4 matching JavaScript inputs with SHA-256 hashes and the exact expected graph source sets. Native workspace descriptors, manifest workspace patterns, npm package placements or pnpm importers determine those sets. The full tree was also inspected for the other configured extractor patterns; no additional supported input was found.

All 16 configured integration extractors ran with namespace `integration:cheeriojs/cheerio@14b76e8e9834f27c43022d05cdaeeae621e2e916` using Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. The result contains 2 graphs, 2 projects, 1606 catalog identities and 5145 edges.

`test/javascript-workspaces-acceptance.test.ts` compares native inputs directly with every retained lock record, package name/version, request and graph-local target. It also verifies native artifact locations and integrity, project names and versions, exact optional flags, selection and target platform/Yarn applicability predicates. It asserts exact observation source sets, exact project/scope roots, catalog membership, declaration names/specifiers, source hashes and issues. npm checks independently walk package placements and links. pnpm checks snapshot and importer references, aliases and links. Yarn checks descriptor maps and both native and current manifest observations, preserving unknown unmatched selections and partial drift adjacency. Classic Yarn adjacency remains unknown because peer declarations are not supplied by its lock records. Yarn raw projections do not claim effective resolver transformations or virtual peer installation contexts.

Issues preserved exactly: none. The inventory retains full severity, file and message assertions. No extractor error was discarded.

The prior result shape was not used as an oracle. This baseline covers the configured extractor behavior for the full pinned source, not successful native builds or an installed dependency environment.
