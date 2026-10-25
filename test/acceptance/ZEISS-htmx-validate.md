# ZEISS/htmx-validate acceptance

Pinned source commit `006043655b0917b26b50e0422befd9b6091ae357`, full tree `b67b55140dd29d66a316e3097604836bd60da558`.
Source archive SHA-256 `fb7735cf71dc2fb8df02508a4b5bb38f609bd2fac636f8d26d1fa77ee68cbdb6`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package-lock.json`: SHA-256 `c1c19e628ed5513c3f8265d6dae9611dcb6214d74c8097614c8f03ef9407c806`.
- `package.json`: SHA-256 `a9fd599312a0531c37042095eb837e23bef4c343f8dde03a1416c3eba039028a`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 1 graphs, 4 exact roots, 816 edges, 440 catalog identities and 1 exact projects.

Native npm lockfile version 3 placements and all outgoing dependency, development, optional and peer requests were compared independently to the result, including nearest ancestor bindings, artifacts and exact versions.

Selection preserves excluded development consumer requests, optional overrides, unknown peers, missing optional requests and native os/cpu/libc predicates; roots retain exact native project identity.

Locked root requests and package metadata remain native lock observations.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
