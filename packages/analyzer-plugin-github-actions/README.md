# @scatool/analyzer-plugin-github-actions

**Note**: This plugin is experimental.

## Native result V2

`extractorV2` and `extractWorkflowV2` return source declarations with one root per
workflow job. Step `uses` references retain native strings without fabricating
resolved action/image versions or their transitive dependencies. Explicit job and
step `if` predicates use the `github-actions` condition language; without an
interpreter their applicability remains unknown. Local/dynamic references remain
requests and are not expanded. Unsupported job forms, including reusable workflow
jobs, retain partial coverage and an issue. Malformed workflows fail extraction
rather than becoming successful empty results.
