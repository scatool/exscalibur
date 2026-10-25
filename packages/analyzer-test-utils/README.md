# @scatool/analyzer-test-utils

Test utilities for analyzer plugins to reduce code duplication and improve test maintainability.

Fixture tests use three complementary checks:

- Core validation rejects invalid references and inconsistent result fields.
- Required `assertResult` callbacks check facts against the native input, including expected
  uncertainty and explicitly allowed extraction errors.
- Full-output snapshots guard the complete normalized `AnalyzerResult`, including contextual
  nodes, every edge, declarations, roots, provenance, native metadata and issues.

Both `createExtractorTests` and `createFileContentTests` run these checks. Tests that invoke an
extractor directly retain their own semantic assertions and snapshot the same normalized result.
Normalization sorts the model's set-valued collections; it does not flatten graphs to PURLs,
remove metadata or discard warnings. Tests use explicit codebase IDs so checkout location does
not become part of project identity.

## Reviewing snapshot changes

Run the affected test file first without updating expectations. For an intentional output change,
trace each changed package, relationship, declaration, scope and completeness claim to its native
fixture or an independent package-manager result. A passing schema check is not sufficient to
approve an expectation. Keep semantic assertions when adding or updating a snapshot.

Generate a candidate with `vp test run <test-file> -u`, inspect the diff against the source evidence,
then rerun without `-u`. Check representative mutations, such as dropping a transitive edge or
changing its target, when changing the snapshot infrastructure. CI runs the package tests through
the repository's `ready` task; missing or changed snapshots fail there.

Native command output can contain execution-specific information. Any test-only stabilization
must name and validate the exact volatile fields, retain their presence, and leave dependency
facts intact. Do not introduce blanket metadata filtering or mask graph relationships to make a
snapshot pass. Repeated runs and a relocated checkout should agree after that documented handling.

Package snapshots are separate from the 87 source-reviewed integration JSON baselines and their
acceptance ledger. Restoring package snapshots does not authorize updating those baselines or
modifying the native fixtures.
