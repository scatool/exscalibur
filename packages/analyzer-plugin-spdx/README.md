# @scatool/analyzer-plugin-spdx

## Result format

The default `extractor` returns format 2 with document-local dependency views.
`extractSpdx(content, { codebase, evidenceFile })` imports a document directly;
invalid input throws, while the file extractor records extraction failures with
unknown coverage.
