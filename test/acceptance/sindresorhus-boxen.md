# sindresorhus/boxen acceptance

Pinned source commit `af0098901175156af7829cbf24259df1dcb8e41d`, full tree `1bd6cb42ef0f2a7198570bb91b48dab1b1e088fd`.
Source archive SHA-256 `79b14bc07eb049cf350aac63645fd5f29aa5d35d2a6acc1330b9897efb43cf32`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package.json`: SHA-256 `2cd776fca5657a13cb9de5e227eb19a60c21ae9985861132d7708bada9667e54`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 1 graphs, 4 exact roots, 13 edges, 0 catalog identities and 1 exact projects.

Every discovered valid manifest retains exact name/specifier source declarations, four scope roots, project ownership and no fabricated package resolution; nonempty closures remain unknown.

Only the root manifest matches; no nested manifests or lockfiles.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
