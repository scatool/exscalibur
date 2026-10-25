# es-shims/Reflect.getPrototypeOf acceptance

Reviewed input is commit `91a8f0d8b9339eaea50002070e552ee1b88e94f7`, tree
`44d888ab44546ad6f9c6dd59db7a8a81b0fce562`. The downloader verified the requested Git commit before
exporting the complete tree. Source archive SHA-256:
`e8f69fafe75544582e8666c39677c688e60800209a036023fddb34d21e1f4a35`.

The exported source has 24 files. Inspection of the full tree found one
matching dependency input, root `package.json`, and no nested manifests or lockfiles
for the sixteen configured integration extractors. Its SHA-256 is
`2d1a2f5bfd38c17ad9977313ddd5aafe7e76b2484d717e561bf5a9c43e9f51ba`.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen configured
extractors ran with this pin's configured options and stable codebase namespace.
Only `packagejson` produced an observation; no extractor reported an issue.
No installation, package download or native dependency resolver was run.

## Source comparison

The source declares `reflect.getprototypeof@1.0.10`. All 8 ordinary
dependency requests and 12 development requests retain their exact native names
and specifiers, including range operators and tags. Optional and peer declaration
scopes are absent in this manifest and contain no requests.

The result has one exact project with definition file `package.json`, one declared
graph, four exact scope roots and five views. All 20 edges are selected
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
