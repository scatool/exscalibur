# ZEISS/htmx-toasts acceptance

Pinned source commit `35f3277e7facce53fc15672c6eea22dfb5f86438`, full tree `be2fbb5abd82c1b40e2c735ef033ee0d1bd7f3db`.
Source archive SHA-256 `f8df5610967e00253f458620755fb480b09ae1e0549c4879f5c2059a375bff2f`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package-lock.json`: SHA-256 `f70ab6360c9e641da61d963994a7589500586f66265f27e438d5937e5884f61c`.
- `package.json`: SHA-256 `4f223199598458767d1fa4d0e75dc07584b2ea3aebffcb12d8a76ed9acb6d061`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 2 graphs, 8 exact roots, 850 edges, 450 catalog identities and 2 exact projects.

Native npm lockfile version 3 placements and all outgoing dependency, development, optional and peer requests were compared independently to the result, including nearest ancestor bindings, artifacts and exact versions.

Selection preserves excluded development consumer requests, optional overrides, unknown peers, missing optional requests and native os/cpu/libc predicates; roots retain exact native project identity.

Locked root requests and package metadata remain native lock observations.

Current @htmx/htmx-toasts and locked @htmx/template-element identities remain distinct observations; npm.manifest_lock_mismatch is retained, with a separate current-manifest declaration graph.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
