# ZEISS/appinsights-express-middleware acceptance

Pinned source commit `0d503139bd9776e240707bb2f5cd740b873e9bbf`, full tree `f3e9031c4e19a9942bedc8ae179459180126afcc`.
Source archive SHA-256 `9673c5bfe67778ab61e5151871c96460d1fcf4b9853aba7986b53db47a6d5ec5`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package-lock.json`: SHA-256 `11281458a6788ce7fabffa16bd490d871793c2a445439f137140cf082852cfed`.
- `package.json`: SHA-256 `96f4c763b79294cb643691bcf60e95893584a7c49c16762f386ae09c9e876ef0`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 1 graphs, 4 exact roots, 1355 edges, 657 catalog identities and 1 exact projects.

Native npm lockfile version 1 placements and all outgoing dependency, development, optional and peer requests were compared independently to the result, including nearest ancestor bindings, artifacts and exact versions.

Selection preserves excluded development consumer requests, optional overrides, unknown peers, missing optional requests and native os/cpu/libc predicates; roots retain exact native project identity.

Version 1 nested placements remain distinct and current-manifest root correlation stays unknown.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
