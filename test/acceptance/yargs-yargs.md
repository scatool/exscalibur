# yargs/yargs acceptance

Pinned source commit `971e351705f0fbc5566c6ed1dfd707fa65e11c0d`, full tree `a4d691158592ec8592a2ad5f91d16b210a722c8d`.
Source archive SHA-256 `a4ef20f113ecada8b16714ac0d9b0361dc4cb18781ea730330c81e6e2690a744`. The complete exported tree and matching-input inventory were independently verified.

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0.

## Native input evidence

- `helpers/package.json`: SHA-256 `8005a3491db7d92f36ac66369861589f9c47123d3a7c71e643fc2c06168cd45a`.
- `package.json`: SHA-256 `fce65d8f6202a830f1eb543d76a55405b41eb708aca01027e32451cc014ebfb2`.
- `test/fixtures/broken-json/package.json`: SHA-256 `67df1799f91429ba21247624b0d052eb79b10c462856266a7d61c6aa737daefd`.
- `test/fixtures/extends/packageA/package.json`: SHA-256 `2c776a98b9abb886dd2b79d51961c9dfc79d90aca76797ad057617e80d684043`.
- `test/fixtures/package.json`: SHA-256 `d370844635c1dcadc68829ecd00130f87f7cdb04ab580ab6925552bbc9439645`.

## Source comparison

All sixteen configured integration extractors executed against the verified pinned source with stable codebase identity; no dependency installation or native resolver was run.

Result preserves 5 graphs, 16 exact roots, 28 edges, 0 catalog identities and 4 exact projects.

Every discovered valid manifest retains exact name/specifier source declarations, four scope roots, project ownership and no fabricated package resolution; nonempty closures remain unknown.

Malformed fixture manifests retain an ERROR core.file_extraction_failed issue and an unknown observation instead of an empty successful graph.

Reproducible assertions are in `test/javascript-fixtures-acceptance.test.ts` and, for npm locks, `test/acceptance/native-npm-lock.ts`. They compare native inputs to every contextual placement and outgoing request, rather than using the legacy baseline as an oracle. The configured integration harness separately re-extracts and compares the accepted result.

## Limits

These are parser observations, not installed or deployed dependency membership. Errors and unknown coverage remain explicit. No new extractor or input syntax support was added.
