# pillarjs/finalhandler acceptance

Reviewed input is commit `27c3f307213825f3f401f8b6efc8b1f45acd93bc`, tree
`eefeb0e3b9f7ff8f612943bd74cf27b541197323`. The downloader verified the requested Git commit before
exporting the complete tree. Source archive SHA-256:
`8ae332a2ea915cb614b3eb34c81a8f21546fbf87d66dd201a579ebbd9f54851d`.

The exported source has 16 files. Inspection of the full tree found one
matching dependency input, root `package.json`, and no nested manifests or lockfiles
for the sixteen configured integration extractors. Its SHA-256 is
`6270796c2654c9caade3c651cebd0df4bf3e1ba42b6c1d9df6135f690e8c17f8`.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen configured
extractors ran with this pin's configured options and stable codebase namespace.
Only `packagejson` produced an observation; no extractor reported an issue.
No installation, package download or native dependency resolver was run.

## Source comparison

The source declares `finalhandler@2.1.0`. All 6 ordinary
dependency requests and 10 development requests retain their exact native names
and specifiers, including range operators and tags. Optional and peer declaration
scopes are absent in this manifest and contain no requests.

The result has one exact project with definition file `package.json`, one declared
graph, four exact scope roots and five views. All 16 edges are selected
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
