# Textualize/rich format 2 acceptance

The source pin is `1d402e0c59f8765e420a5a4440eb2fca7465d1ae`. The verified Git tree is
`b0e4d7c3819caf68920a8766b70b28fa9e79abc3`; the explicit Git-transport archive SHA-256 is
`30ac4bbf1ce8635248d1169808716fa7a6afeee1b2e0f2c81903a62aa8c74b44`.

The extracted tree was independently reconstructed from all 552 source files,
their bytes, executable modes, symlink targets and directory structure; its Git
tree hash matches the pin.

All 16 extractors configured in `test/integration.test.ts` executed against this
source with namespace `integration:Textualize/rich@1d402e0c59f8765e420a5a4440eb2fca7465d1ae`.
Tools: Node.js 22.23.4, pnpm 10.24.0, Vite+ 1.3.0; semantic TOML checks use the
existing pinned smol-toml 1.7.0 parser. No external resolver was invoked by a
matching input. No ERROR issue was reported.

The normalized baseline contains 49 catalog packages, 3 project subjects,
4 graphs, 56 views, 7 roots and 130 edges.

The Poetry manifest declares three runtime packages (`pygments`, optional
`ipywidgets`, and `markdown-it-py`) and seven development requests. The Python
version range remains a native environment fact, not a package dependency. Optional
Poetry declarations retain their predicate and original table. The 49 lock records
contain 55 native outgoing requests. Both main and development membership groups
retain native Python-version/optional applicability; their closure completeness is
partial without an environment evaluator. The documentation requirements retain
four pinned declarations, without converting those pins into resolved installations.

`test/python-acceptance.test.ts` compares each native input with the baseline:
all requests and their original values, scoped declarations, native package records,
lock membership, candidate binding uncertainty, applicability predicates, catalog
coverage and conservative query completeness. It rejects unexpected issue codes/files.
The old format 1 baseline was not used as an oracle. Current manifests correlated
by a lock importer remain independent declaration observations; duplicate source
observations from separate extractor invocations do not imply additional scopes.

All 3 inputs matching the configured extractors are listed below. No other
configured extractor patterns match the recovered archive. GitHub Actions workflows
and other files outside these 16 extractors are not added to integration scope.

| Input                   | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `docs/requirements.txt` | `3fa7b4f868a8aede2201721f83c91800199d69d71db6f4e8cb8b7d38ca2570ec` |
| `poetry.lock`           | `b7ef18e9e25d31bcc21853b3774cbec13f0874d517bc023156a526dd5ada1908` |
| `pyproject.toml`        | `dfd8bbc464259c2b8129ebc812965d93f9eb45082828e6c2bd4e47e6ff4d9743` |

Issues retained in the baseline:

None.

Baseline: `test/__snapshots__/Textualize+rich.json`, SHA-256
`7d0ae889b7b0c5912f6f7b6332baa036659ff0f027a10ddfba77a089e6bef79e`.

This establishes extraction and conservative source-model fidelity, not successful
native builds, installed dependency resolution or runtime membership.
