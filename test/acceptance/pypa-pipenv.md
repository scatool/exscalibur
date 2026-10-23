# pypa/pipenv format 2 acceptance

The source pin is `483baf4c69ce400b1dbb269000a51c07ac2b9d89`. The verified Git tree is
`8902e895803007b48c02af7e8a373ab7240f0a00`; the explicit Git-transport archive SHA-256 is
`a2b2e18e764384199a022b5148b32075222c7a6cf4ba115d725a4cb068c7926f`.

All 856 superproject blobs and their modes were independently compared with the
exact fetched Git tree. The archive excludes eight recorded submodule contents;
this acceptance covers the superproject archive only, consistent with the existing
downloader scope. It does not claim recursive repository or nested-input coverage.
The following Gitlinks are preserved as source provenance, not fetched or analyzed:

| Path                                   | Commit                                     |
| -------------------------------------- | ------------------------------------------ |
| `tests/pypi`                           | `4ee34a262c487cce1ea5b75f8db25712de02da9f` |
| `tests/test_artifacts/git/dateutil`    | `6618dee970ec1e5f92e0f48ec74584caf13075aa` |
| `tests/test_artifacts/git/flask`       | `1b4ace9ba5e77679bf9d8e409283654f7589907e` |
| `tests/test_artifacts/git/jinja2`      | `a7f1f528f5e77d5401a96aa326885508245f7c6f` |
| `tests/test_artifacts/git/pinax`       | `147d854322cc2ab8246b9f52fa3189dfca3cddec` |
| `tests/test_artifacts/git/pyinstaller` | `19d8a378987d6115c0acb72ef954bbf3bca3c61b` |
| `tests/test_artifacts/git/requests`    | `4983a9bde39c6320aa4f3e34e50dac6e263dab6f` |
| `tests/test_artifacts/git/six`         | `aa4e90bcd7b7bc13a71dfaebcb2021f4caaa8432` |

All 16 extractors configured in `test/integration.test.ts` executed against this
source with namespace `integration:pypa/pipenv@483baf4c69ce400b1dbb269000a51c07ac2b9d89`.
Tools: Node.js 22.23.4, pnpm 10.24.0, Vite+ 1.3.0; semantic TOML checks use the
existing pinned smol-toml 1.7.0 parser. No external resolver was invoked by a
matching input. No ERROR issue was reported.

The normalized baseline contains 104 catalog packages, 8 project subjects,
8 graphs, 125 views, 13 roots and 151 edges.

Both Pipfile locks were inspected independently, preserving exact default/develop
membership, native records and PEP 508 markers. Their 104 distinct catalog packages
have unknown adjacency because Pipfile.lock does not encode dependency edges. VCS
or editable entries without a pinned package version remain declarations. All four
lock-group queries retain unknown closure completeness. Four pyproject inputs and
two requirements inputs were also inspected. Three build-system-only fixture
pyprojects preserve unknown runtime dependency/root coverage and explicit warnings;
they are not reported as dependency-free projects. Documentation and fixture
requirements retain every declaration, including editable source and extras.

`test/python-acceptance.test.ts` compares each native input with the baseline:
all requests and their original values, scoped declarations, native package records,
lock membership, candidate binding uncertainty, applicability predicates, catalog
coverage and conservative query completeness. It rejects unexpected issue codes/files.
The old format 1 baseline was not used as an oracle. Current manifests correlated
by a lock importer remain independent declaration observations; duplicate source
observations from separate extractor invocations do not imply additional scopes.

All 8 inputs matching the configured extractors are listed below. No other
configured extractor patterns match the recovered archive. GitHub Actions workflows
and other files outside these 16 extractors are not added to integration scope.
`.gitmodules` is additionally hashed as submodule-scope provenance.

| Input                                                  | SHA-256                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `Pipfile.lock`                                         | `ecaef646b699b5e6b32f1aa0adf10c380bef8b31a787b7a3d72fd8fb14b11526` |
| `docs/requirements.txt`                                | `5ee4f58fec98fbd0833d0ac0b4bb8460b3baf76f8ac3259462d508c6ac0b44bd` |
| `examples/Pipfile.lock`                                | `41672da9a4412f65b5a21cdac993d2380766c0907abf22a64014fc3fb6918327` |
| `pyproject.toml`                                       | `b4b27ddbd6b53d1bf84a55f9f6e67df2cb2e91bad2e6ebf6b1635f09f25d62c3` |
| `tests/fixtures/cython-import-package/pyproject.toml`  | `b7dbadeb98966ce86a2252113054be02b21c01b0f5dd27a3ac095a1e77da3e81` |
| `tests/fixtures/fake-package/docs/requirements.txt`    | `241963d24aacc5cb5e599a57004282a1bcea1bea6258f01f8f7fc1c78ea2f7e7` |
| `tests/fixtures/fake-package/pyproject.toml`           | `7ead794fd38f7684ed105f977b5e9e4458e29d3be3c86e77c1bf554fd465108a` |
| `tests/fixtures/legacy-backend-package/pyproject.toml` | `34b809a3e151f4df068d1a8ce1015f396695d682d71655735e6a0b829cedfdb4` |
| `.gitmodules`                                          | `14026a1375baf6b528839e29c1ea2a6e01fe05cc37c90a52c89c0af14dd96679` |

Issues retained in the baseline:

- `pyprojecttoml.unsupported_project_metadata` — `tests/fixtures/cython-import-package/pyproject.toml`: No supported project metadata table establishes runtime dependency coverage

- `pyprojecttoml.unsupported_project_metadata` — `tests/fixtures/fake-package/pyproject.toml`: No supported project metadata table establishes runtime dependency coverage

- `pyprojecttoml.unsupported_project_metadata` — `tests/fixtures/legacy-backend-package/pyproject.toml`: No supported project metadata table establishes runtime dependency coverage

Baseline: `test/__snapshots__/pypa+pipenv.json`, SHA-256
`caa0337c82555eb4ca8239c66b7e28f9412ff1f9b7b11d773fe7daf03f21e15e`.

This establishes extraction and conservative source-model fidelity, not successful
native builds, installed dependency resolution or runtime membership.
