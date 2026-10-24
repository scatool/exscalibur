# pdm-project/pdm format 2 acceptance

The source pin is `777f43cf002c8c42dd1f6f785c1f076e2bf1639c`. The verified Git tree is
`11bf5265e796ba25618e6222d780a99a45a1248d`; the explicit Git-transport archive SHA-256 is
`1c74550f63bf673ac2f58850a27fb3ef592eb96c2d919888edf8eb478a8fc053`.

The extracted tree was independently reconstructed from all 380 source files,
their bytes, executable modes, symlink targets and directory structure; its Git
tree hash matches the pin.

All 16 extractors configured in `test/integration.test.ts` executed against this
source with namespace `integration:pdm-project/pdm@777f43cf002c8c42dd1f6f785c1f076e2bf1639c`.
Tools: Node.js 22.23.4, pnpm 10.24.0, Vite+ 1.3.0; semantic TOML checks use the
existing pinned smol-toml 1.7.0 parser. No external resolver was invoked by a
matching input. No ERROR issue was reported.

The normalized baseline contains 132 catalog packages, 31 project subjects,
35 graphs, 212 views, 75 roots and 561 edges.

All 22 pyproject inputs were inspected, including application metadata, templates,
legacy Poetry fixtures, circular path requests, direct file references and monorepo
subjects. They stay separate exact projects rather than a shared PURL union. Four
PDM locks contain 137 package records (132 distinct catalog PURLs) and 190 original
outgoing requests. Group membership is lock evidence, not reconstructed manifest
roots; ambiguous versions/extras or source requests remain unresolved, while range
candidates retain unknown selection. All lock-group closure queries are partial.

Five requirements inputs preserve continuation hashes and native options. The
`-r requirements.txt` fixture remains unresolved with partial adjacency and an
explicit include warning; it does not become an empty complete root. Four index
option warnings retain the original options on their source views. Legacy Flit
metadata is outside this extractor's supported project metadata: its source remains
intact, an explicit warning is reported, and dependency/root coverage is unknown.
No Flit extractor or additional package-manager support was added.

`test/python-acceptance.test.ts` compares each native input with the baseline:
all requests and their original values, scoped declarations, native package records,
lock membership, candidate binding uncertainty, applicability predicates, catalog
coverage and conservative query completeness. It rejects unexpected issue codes/files.
The old format 1 baseline was not used as an oracle. Current manifests correlated
by a lock importer remain independent declaration observations; duplicate source
observations from separate extractor invocations do not imply additional scopes.

All 31 inputs matching the configured extractors are listed below. No other
configured extractor patterns match the recovered archive. GitHub Actions workflows
and other files outside these 16 extractors are not added to integration scope.

| Input                                                                            | SHA-256                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pdm.lock`                                                                       | `4e1f6f66ce29072a867d5ca1091c7786f921aa64b1532c8494f1a9f8b05e69cb` |
| `pyproject.toml`                                                                 | `cc5a71935f70acec809d41e6f1db762fea3b11670dee717852b111fe15d4f704` |
| `src/pdm/cli/templates/default/pyproject.toml`                                   | `43ecd0428800308e33494435e2ae288ca00283d9a09bbba3b6795a3d6601eb99` |
| `src/pdm/cli/templates/minimal/pyproject.toml`                                   | `43ecd0428800308e33494435e2ae288ca00283d9a09bbba3b6795a3d6601eb99` |
| `tests/fixtures/projects/demo/pdm.lock`                                          | `efc1a00fc069a6e180ea94fd3d9bd38cbae9100861fe15a8db867d11314b30ca` |
| `tests/fixtures/projects/demo/pyproject.toml`                                    | `a826fa2ef1f16de5960ffae6f731dc02b7a1b29b9797a2dc459aa789eb2410a3` |
| `tests/fixtures/projects/demo-combined-extras/pyproject.toml`                    | `6e335d01914816c6416a13edeb6ce4ba3dfb496e40aee48f61580354ac89304e` |
| `tests/fixtures/projects/demo-module/pyproject.toml`                             | `207cd756bc25b5902187dbcae490a53b82fc8e0ae019c387381a900574d3df2d` |
| `tests/fixtures/projects/demo-package/pdm.lock`                                  | `ee038b8ef408b3028c10368787c4f05d13ab20e9b0a9a172d78d21b5942becce` |
| `tests/fixtures/projects/demo-package/pyproject.toml`                            | `ad1ae56e3755176c7828d6c61217436ca28fae597d89c633c4860feb35d90ca5` |
| `tests/fixtures/projects/demo-package/requirements.txt`                          | `430a5fc88782d5eea01148e8489f1e0698275e01b007c4fad3900a8fb796574a` |
| `tests/fixtures/projects/demo-package/requirements_simple.txt`                   | `8619f5b15207db2ee8fdeab0d3c180f3a226e92a1f4aa0e36b427bae8c5a6f40` |
| `tests/fixtures/projects/demo-package-has-dep-with-extras/pdm.lock`              | `14a574a1b6bc9524c432d39c56f20626fa6b6ecf363fc53a23537521f94ce827` |
| `tests/fixtures/projects/demo-package-has-dep-with-extras/pyproject.toml`        | `3d360270d28164c5c8172c9de23f45e284c98cb0b764f2687b73a582d47dfcdc` |
| `tests/fixtures/projects/demo-package-has-dep-with-extras/requirements.txt`      | `d5d2977fe5d46992efb293a433f00bfe1a9cb186c683bacdefcf56de9e3589ba` |
| `tests/fixtures/projects/demo-parent-package/package-b/pyproject.toml`           | `27a50902684b6e699cbf1824798279c8a6a39c7f7c04145fe2096de97d80c2a7` |
| `tests/fixtures/projects/demo-src-package/pyproject.toml`                        | `2ab97d51469074c10dee6f668f2f515800693da75b821b76b59494dc38a6f2b2` |
| `tests/fixtures/projects/flit-demo/pyproject.toml`                               | `a530f3e515f9320cf08adcc26634ec4b261170948d855470be026f7a93c01df9` |
| `tests/fixtures/projects/poetry-demo/pyproject.toml`                             | `9a8c517099427d4259e74690f425c89953ab332042338986cc320aa600c6f88c` |
| `tests/fixtures/projects/poetry-with-circular-dep/packages/child/pyproject.toml` | `21bdc644160b5d5373b7467aec3140a5404708af87c8e5b6c69e13b9fdfb6095` |
| `tests/fixtures/projects/poetry-with-circular-dep/pyproject.toml`                | `8b84c1b5414152c0a5d418cc117644bec3bf283c45045c91774517c0c6964fca` |
| `tests/fixtures/projects/test-hatch-static/pyproject.toml`                       | `b407f66dcefbf5ff62078c6ce3f77b996356d509765e6d8705526fe603a07701` |
| `tests/fixtures/projects/test-monorepo/core/pyproject.toml`                      | `cd95b58c7d558830b869f21cbf1107de96b641f13d8e127e3216265080b510c3` |
| `tests/fixtures/projects/test-monorepo/package_a/pyproject.toml`                 | `b4e1c5e203f09136618705acd617237804626c130e2120408f759d35f1750a19` |
| `tests/fixtures/projects/test-monorepo/package_b/pyproject.toml`                 | `20f86a9f5583ea7dbef790169ad543dbca0a0c88c25aec377d564e851e036eb0` |
| `tests/fixtures/projects/test-monorepo/pyproject.toml`                           | `6482ff6c03fca321975416fec09ea6ea6782a29bbfe4395defc903409d317079` |
| `tests/fixtures/projects/test-package-type-fixer/pyproject.toml`                 | `b889ba51362f44bd0fea5e9e4b92399bfc8173ffd11e6b07b3c5cf2098029820` |
| `tests/fixtures/projects/test-plugin-pdm/pyproject.toml`                         | `dd64e899d3f2b018a23a5816081d79126b04209ce352b985e1e21c0d6ba32a49` |
| `tests/fixtures/pyproject.toml`                                                  | `7f5211396a968aabc409c26927ebfb7b6f9ef11cd74f1cce63d963db91f94350` |
| `tests/fixtures/requirements-include.txt`                                        | `69075054c6d3bf5e0104bbc5d72895f380f050216a76ee8978dc4fbfd62f95e8` |
| `tests/fixtures/requirements.txt`                                                | `111422e5dcb7d9b30cc997d9db3fd95a52a507f3f2fe66ef9eeff554eae8d276` |

Issues retained in the baseline:

- `pyprojecttoml.unsupported_project_metadata` — `tests/fixtures/projects/flit-demo/pyproject.toml`: No supported project metadata table establishes runtime dependency coverage

- `requirementstxt.include_not_followed` — `tests/fixtures/requirements-include.txt`: Requirement/constraint input is not followed: -r requirements.txt

- `requirementstxt.option_preserved` — `tests/fixtures/projects/demo-package/requirements.txt`: Non-package requirement option preserved: --extra-index-url https://test.pypi.org/simple

- `requirementstxt.option_preserved` — `tests/fixtures/projects/demo-package/requirements_simple.txt`: Non-package requirement option preserved: --extra-index-url https://test.pypi.org/simple

- `requirementstxt.option_preserved` — `tests/fixtures/requirements.txt`: Non-package requirement option preserved: --extra-index-url=https://pypi.example.com/simple

- `requirementstxt.option_preserved` — `tests/fixtures/requirements.txt`: Non-package requirement option preserved: --index-url=https://pypi.org/simple

Baseline: `test/__snapshots__/pdm-project+pdm.json`, SHA-256
`00cc63b19aae99e33d4f4e9befcbd0d5ecb7af9358687694ec74287b3964c1ab`.

This establishes extraction and conservative source-model fidelity, not successful
native builds, installed dependency resolution or runtime membership.
