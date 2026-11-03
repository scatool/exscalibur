# ljharb/get-intrinsic acceptance

Reviewed input is commit `75b38548845e37d3792e6580c882c166e8b769cc`, tree
`00b2ac5b9ae7448c4d2e9df0ca1217785e7a7073`. The downloader verified the requested Git commit before
exporting the complete tree. Source archive SHA-256:
`14cd65c3bc7f6e0dc27da4108bf94810f3a7f40b8cde6d1b493eaef232ee15d6`.

The exported source has 17 files. Inspection of the full tree found one
matching dependency input, root `package.json`, and no nested manifests or lockfiles
for the sixteen configured integration extractors. Its SHA-256 is
`4024f3aaa666a7fbb8fb240b940da0eed54713a194aa711c03bd49ecd083ee58`.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen configured
extractors ran with this pin's configured options and stable codebase namespace.
Only `packagejson` produced an observation; no extractor reported an issue.
No installation, package download or native dependency resolver was run.

## Source comparison

The source declares `get-intrinsic@1.3.1`. All 13 ordinary
dependency requests and 18 development requests retain their exact native names
and specifiers, including range operators and tags. Optional and peer declaration
scopes are absent in this manifest and contain no requests.

The result has one exact project with definition file `package.json`, one declared
graph, four exact scope roots and five views. All 31 edges are selected
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
