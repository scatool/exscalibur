# encode/httpx format 2 acceptance

The source pin is `ae1b9f66238f75ced3ced5e4485408435de10768`. The verified Git tree is
`a0348e2a1b9fc43336690740213ea68fd833e703`; the explicit Git-transport archive SHA-256 is
`8226294cf01c9e2a812f23ae20e1871a5fe0f72c63b77a31eb29636bff975c45`.

The extracted tree was independently reconstructed from all 125 source files,
their bytes, executable modes, symlink targets and directory structure; its Git
tree hash matches the pin.

All 16 extractors configured in `test/integration.test.ts` executed against this
source with namespace `integration:encode/httpx@ae1b9f66238f75ced3ced5e4485408435de10768`.
Tools: Node.js 22.23.4, pnpm 10.24.0, Vite+ 1.3.0; semantic TOML checks use the
existing pinned smol-toml 1.7.0 parser. No external resolver was invoked by a
matching input. No ERROR issue was reported.

The normalized baseline contains 0 catalog packages, 2 project subjects,
2 graphs, 7 views, 7 roots and 28 edges.

The PEP 621 manifest contains four runtime requests and eight optional requests
across brotli, cli, http2, socks and zstd scopes. Both mutually exclusive Brotli
implementation predicates remain present. Dynamic version metadata does not invent
a project version or imply unknown dependency declarations. The tooling requirements
retain 16 declarations, including editable `-e .[brotli,cli,http2,socks,zstd]`, exact
pins and requested extras. There is no lock observation and no package catalog or
resolved binding. Every nonempty scope has unknown resolved closure completeness.

`test/python-acceptance.test.ts` compares each native input with the baseline:
all requests and their original values, scoped declarations, native package records,
lock membership, candidate binding uncertainty, applicability predicates, catalog
coverage and conservative query completeness. It rejects unexpected issue codes/files.
The old format 1 baseline was not used as an oracle. Current manifests correlated
by a lock importer remain independent declaration observations; duplicate source
observations from separate extractor invocations do not imply additional scopes.

All 2 inputs matching the configured extractors are listed below. No other
configured extractor patterns match the recovered archive. GitHub Actions workflows
and other files outside these 16 extractors are not added to integration scope.

| Input              | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `pyproject.toml`   | `f20daa9f2eb1f4cfdbb0c5e74fa3bfe99ea260b8bbf5df6ada3f7f25fd7956ec` |
| `requirements.txt` | `43d93f514608a51aa7841ba327567a804efe5ddb2435d44f57bcb3532b48ad63` |

Issues retained in the baseline:

None.

Baseline: `test/__snapshots__/encode+httpx.json`, SHA-256
`3f96222949593c27295820248d6ef1782d4d4cdd17bbc227a7b020b323d22c94`.

This establishes extraction and conservative source-model fidelity, not successful
native builds, installed dependency resolution or runtime membership.
