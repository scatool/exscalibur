# expressjs/serve-index acceptance

Reviewed input is commit `364e273836b64bc9362177d612704086f6dcc0d2`, tree
`9cc387791bd8abd39877b73aa6e59462ddcf23dc`. The downloader verified the requested Git commit before
exporting the complete tree. Source archive SHA-256:
`c3295fcfe6e113a640ad51485683f23083c6d328cff58c630c0cdb41cee30403`.

The exported source has 129 files. Inspection of the full tree found one
matching dependency input, root `package.json`, and no nested manifests or lockfiles
for the sixteen configured integration extractors. Its SHA-256 is
`a785d698c7ace9281afea4613d135a4e0fdf10c12e51010eab5ed5ead78f8a4e`.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen configured
extractors ran with this pin's configured options and stable codebase namespace.
Only `packagejson` produced an observation; no extractor reported an issue.
No installation, package download or native dependency resolver was run.

## Source comparison

The source declares `serve-index@1.9.1`. All 7 ordinary
dependency requests and 6 development requests retain their exact native names
and specifiers, including range operators and tags. Optional and peer declaration
scopes are absent in this manifest and contain no requests.

The result has one exact project with definition file `package.json`, one declared
graph, four exact scope roots and five views. All 13 edges are selected
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
