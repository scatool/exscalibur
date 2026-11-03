# django/django format 2 acceptance

The source pin is `c3c9f1908e62eea528377e3788e78594a8361189`. The verified Git tree is
`a3e92f1747cbc0375973fd61b032358da8f9dff0`; the explicit Git-transport archive SHA-256 is
`9729c9e5e307d36a28acc211a2b91d39bccbd6fab26b0491577fc5cd333fe49f`.

The extracted tree was independently reconstructed from all 7012 source files,
their bytes, executable modes, symlink targets and directory structure; its Git
tree hash matches the pin.

All 16 extractors configured in `test/integration.test.ts` executed against this
source with namespace `integration:django/django@c3c9f1908e62eea528377e3788e78594a8361189`.
Tools: Node.js 22.23.4, pnpm 10.24.0, Vite+ 1.3.0; semantic TOML checks use the
existing pinned smol-toml 1.7.0 parser. No external resolver was invoked by a
matching input. No ERROR issue was reported.

The normalized baseline contains 0 catalog packages, 4 project subjects,
4 graphs, 10 views, 9 roots and 16 edges.

The Python project declares `asgiref>=3.9.1`, `sqlparse>=0.5.0` and Windows-only
`tzdata`; the Windows predicate remains conditional. Argon2 and bcrypt optional
scopes retain their exact requests. Dynamic version metadata stays unreported.
The JavaScript package manifest contributes six development declarations, without
inventing resolved package versions. The documentation requirements contain five
requests; the template requirements input contains only a comment and correctly
has an empty complete declaration list. No package catalog or lock graph exists.

`test/python-acceptance.test.ts` compares each native input with the baseline:
all requests and their original values, scoped declarations, native package records,
lock membership, candidate binding uncertainty, applicability predicates, catalog
coverage and conservative query completeness. It rejects unexpected issue codes/files.
The old format 1 baseline was not used as an oracle. Current manifests correlated
by a lock importer remain independent declaration observations; duplicate source
observations from separate extractor invocations do not imply additional scopes.

All 4 inputs matching the configured extractors are listed below. No other
configured extractor patterns match the recovered archive. GitHub Actions workflows
and other files outside these 16 extractors are not added to integration scope.

| Input                                                                                   | SHA-256                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/requirements.txt`                                                                 | `aa58469ea7814d20e8600cb4ca9f77e03759f993ca04985fc130dfdd4192da27` |
| `package.json`                                                                          | `9c354de6094567898d346ad311a24b5d370beb80a1bec4314b0c187435f271b3` |
| `pyproject.toml`                                                                        | `75a54f0930d44b45ec26d46169b4bf8b9318f28b96d68476a29a339f6e57fef7` |
| `tests/admin_scripts/custom_templates/project_template/additional_dir/requirements.txt` | `ad106748c5521e7ceda61a730c5ef0727a68a786b7e61069f0b1f66c13660dbb` |

Issues retained in the baseline:

None.

Baseline: `test/__snapshots__/django+django.json`, SHA-256
`1408dab966f3689ef7a9521422bfc59e97e3cb92987cc1f54401212ff6a615e0`.

This establishes extraction and conservative source-model fidelity, not successful
native builds, installed dependency resolution or runtime membership.
