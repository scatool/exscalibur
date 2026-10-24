# ZEISS/template-htmx-ext acceptance

Pinned source commit `4932fa74143a14620b30b21667c0ce354c3525cb`, full tree `358c35f4b578d606fc42bd3333cdf88e5472d0c0`.
Source archive SHA-256 `641ea84d1634cc929119fad69a0d8dc51cd82359bacc4884f0a7fb906b158351`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package-lock.json`: SHA-256 `a56c91da74d1f4a60c21e4602a273cd570ffb97e04e56f6524aa9f50c60c6ea2`.
- `package.json`: SHA-256 `fb18fac9c042d12679a5d9d11e64d568545e18510ce76050fb05cf75dbdf1140`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 1 graphs, 4 exact roots, 765 edges, 404 catalog identities and 1 exact projects.

Native npm lockfile version 3 placements and all outgoing dependency, development, optional and peer requests were compared independently to the result, including nearest ancestor bindings, artifacts and exact versions.

Selection preserves excluded development consumer requests, optional overrides, unknown peers, missing optional requests and native os/cpu/libc predicates; roots retain exact native project identity.

Locked root requests and package metadata remain native lock observations.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
