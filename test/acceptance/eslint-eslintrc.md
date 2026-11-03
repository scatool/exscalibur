# eslint/eslintrc acceptance

Pinned source commit `13ccd1d0daca2291f4e63b9475e287bfe1a0deff`, full tree `69de6a1168ddfd50016ea6c041cb4f4b841bf924`.
Source archive SHA-256 `bc3b4af8b0a627ff345cd2a6236cbc4ac2cb886b194982f5f227fa607dd707c5`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `package.json`: SHA-256 `a55e010e4b27466760bfc830e9a197accf98790a192f1cfc5ad005b0dd488d00`.
- `tests/fixtures/config-extends/package.json`: SHA-256 `3fec03cf435c8d767a1ac62a4ae54dec5588a9a1c60ab01f093eb0b408c6a45a`.
- `tests/fixtures/config-file/bom/package.json`: SHA-256 `35a5387e4e2482267f3ed0f2450a21a4aefcdb3db7697dc11d48447df60a5d12`.
- `tests/fixtures/config-file/broken-package-json/package.json`: SHA-256 `0bf9a7c4316b3f05627c486152e5398d2cfdce4a39982ddae847db15d76c9831`.
- `tests/fixtures/config-file/package-json/package.json`: SHA-256 `57ff766b1a04f242ce1ac81cdc5baf3425018a395b5df9580946429a6199af9d`.
- `tests/fixtures/config-hierarchy/broken/package.json`: SHA-256 `85d4f40df3aed75e1b394e1f947e55ef11acd37bd48db0025589ee920a62e1b1`.
- `tests/fixtures/config-hierarchy/packagejson/package.json`: SHA-256 `c8f5b36b653cafe2b3d949496b2a72d4717b3e90b64840819dea818707f70f8e`.
- `tests/fixtures/config-hierarchy/packagejson/subdir/package.json`: SHA-256 `f8b4e084522810dd166eb24d72ad3e3dbd3c384c2e93d62f5bb426a037001110`.
- `tests/fixtures/config-hierarchy/packagejson/subdir/subsubdir/package.json`: SHA-256 `afba84032a1f37a334679ed36c42ca9a2451a7c3653a7ed1dbc3114313eb68d9`.
- `tests/fixtures/config-hierarchy/packagejson/subdir/subsubdir/subsubsubdir/package.json`: SHA-256 `ce35e494acbadbdf121bfa35b94c9736fb7d53e01bb3189ef2e606a66f18591b`.
- `tests/fixtures/config-hierarchy/personal-config/home-folder/project/package.json`: SHA-256 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`.
- `tests/fixtures/config-hierarchy/personal-config/home-folder-with-packagejson/package.json`: SHA-256 `676b6e17f26754611d7796ce5a6b7a3b53120b10e98d302e2a7beaf3e66dd1dc`.
- `tests/fixtures/config-hierarchy/personal-config/project-with-config/package.json`: SHA-256 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`.
- `tests/fixtures/config-hierarchy/personal-config/project-without-config/package.json`: SHA-256 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 14 graphs, 52 exact roots, 20 edges, 0 catalog identities and 13 exact projects.

Every discovered valid manifest retains exact name/specifier source declarations, four scope roots, project ownership and no fabricated package resolution; nonempty closures remain unknown.

Malformed fixture manifests retain an ERROR core.file_extraction_failed issue and an unknown observation instead of an empty successful graph.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
