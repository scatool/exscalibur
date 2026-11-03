# expressjs/body-parser acceptance

Reviewed input is commit `b85fe580d3c924d042e73ab5ba416374c2a55f6b`, tree
`8bef4e81e0bf1baf7d8f3deec6846d9adbba737c`. The downloader verified the requested Git commit before
exporting the complete tree. Source archive SHA-256:
`9ef0a041af48b45177515c34739fb6e10143bcc33f98d76935d0b93271998b86`.

The exported source has 25 files. Inspection of the full tree found one
matching dependency input, root `package.json`, and no nested manifests or lockfiles
for the sixteen configured integration extractors. Its SHA-256 is
`9d96a9997f35bd33db3ce35978b95fecef4fcd583420fc743649b51dc93fbdd9`.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen configured
extractors ran with this pin's configured options and stable codebase namespace.
Only `packagejson` produced an observation; no extractor reported an issue.
No installation, package download or native dependency resolver was run.

## Source comparison

The source declares `body-parser@2.2.0`. All 9 ordinary
dependency requests and 10 development requests retain their exact native names
and specifiers, including range operators and tags. Optional and peer declaration
scopes are absent in this manifest and contain no requests.

The result has one exact project with definition file `package.json`, one declared
graph, four exact scope roots and five views. All 19 edges are selected
source declarations with no target view, no invented resolved version and no
catalog packages. Selection describes the presence of each declaration in the
source, not installation or runtime applicability. The consumer view retains
unknown adjacency. Both nonempty scope closures retain unknown resolution;
the two empty declaration scopes have complete empty closures.

Every graph, root, node and edge was checked against the native manifest. The
reproducible manifest assertions in `test/integration-acceptance.test.ts` compare
all name/specifier pairs, exact source ownership, status/selection, evidence,
absence of targets, catalog emptiness and query completeness. The focused
integration harness runs the configured extractor set against this baseline.

## Acceptance limits

This is a source declaration observation. It does not establish transitive
resolution, installed package versions or deployed artifact membership. The
obsolete PURL-union baseline was not used as a semantic oracle.
