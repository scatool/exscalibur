# @scatool/analyzer-plugin-cdx

**Note**: This plugin is experimental.

## Result format

The default `extractor` returns format 2 with document-local dependency views.
`extractCycloneDX(content, { codebase, evidenceFile })` imports a document directly;
invalid input throws, while the file extractor records extraction failures with
unknown coverage.
