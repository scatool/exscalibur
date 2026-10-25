# vercel/serve-handler acceptance

Pinned source commit `329bcba871abed617d4b32cfefd79b5ddc35e497`, full tree `192fcb2a822eb5cd6e8211b7d96ff96be81612b0`.
Source archive SHA-256 `1dc1a487ba7b2f93dd3ed072b37d6daf0a1bf8419c5dd4557cf0f506d6f61b05`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package.json`: SHA-256 `87a8e2787209396ae01990624ab943d6d44c3e8301991bd850d1582b497ccdcd`.
- `yarn.lock`: SHA-256 `d0e6ca6c193b420f630b9eddbdc5494258816047f97aac8111bed5ddb6813fd7`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 3 graphs, 8 exact roots, 1663 edges, 444 catalog identities and 1 exact projects.

All 444 native Yarn records, 512 descriptors and 803 outgoing native requests in each raw/correlated graph match the lock source, including exact target descriptor mappings and artifacts.

Raw package adjacency and native root enumeration remain unknown; correlated manifest bindings retain unknown selection and development consumer exclusions. Raw descriptor projection does not claim effective native resolver behavior.

The symlink test/fixtures/symlinks/package.json points to ../../../package.json and aliases the root manifest; it is not an additional discovered project.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
