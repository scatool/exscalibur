# Offline npm optional-dependency oracle

This is a test-only native comparison. Normal extraction remains lockfile-only: it does not invoke npm, install packages, execute scripts, contact registries, or mutate the input repository.

Regenerate with Node 22.23.4 and an explicitly supplied installation of npm 11.9.0 (bundled Arborist 9.2.0):

```sh
node packages/analyzer-plugin-javascript/src/packagelockjson/npm-optional-oracle.mjs "$NPM_ROOT" packages/analyzer-plugin-javascript/src/packagelockjson/__fixtures__/npm-optional-oracle
```

The generator packs seven tiny, locally authored package manifests, then uses an isolated temporary project and cache. Packing and Arborist reification are offline with scripts disabled; the registry is an unreachable loopback address. No source installation or dependency updates occur in this repository. Temporary files are removed. The only retained writes are explicitly requested oracle fixtures. Tool versions, target platform, complete authored manifests, source locks, lock hashes, native virtual/actual edges and physical installed manifests are recorded. Package tarballs are regenerated from the recorded source objects.

The target environment is Linux/x64/glibc. Each case first generates a lock with `packageLockOnly`, reads its virtual tree, and then performs a separate test-only reification. `omit` is passed to `reify()` itself, as required by this Arborist API. Required platform rejection produces no source lock. The override case changes only the manifest's override policy after lock generation; its relative override target is interpreted from the parent package's placement during reification.

| Case                                     | Virtual observation                                                                     | Actual test installation                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Same name required and optional requests | One optional edge, targeting leaf 2.0.0                                                 | Leaf 2.0.0                                                   |
| Missing optional tarball                 | Incomplete lock entry; virtual edge `INVALID`                                           | Success, package absent                                      |
| Optional omitted                         | Leaf 1.0.0 retained in lock                                                             | Success, package absent                                      |
| Compatible optional platform             | os/cpu metadata retained                                                                | Package installed                                            |
| Incompatible optional os or cpu          | Package retained in lock                                                                | Success, package absent                                      |
| Incompatible required os                 | Lock generation rejects `EBADPLATFORM`                                                  | Reification rejects `EBADPLATFORM`                           |
| Optional libc restriction                | Generated lock omits libc                                                               | Reification installs package; physical manifest retains libc |
| Override-only current policy change      | Raw leaf-1 request remains; effective leaf-2 request is `INVALID` against locked leaf 1 | Reification selects leaf 2                                   |

The libc case identifies a native metadata boundary: npm's generated lock and Arborist's hydrated tree omit the authored libc field. The extractor cannot preserve information absent from its source lock. The physical installed manifest is recorded separately so that a cached actual-tree observation is not mistaken for a complete manifest read.

The override case does not prove that a lock is stale merely because it lacks an overrides field. Previous override policy is not recoverable from that lock. It proves that current-policy virtual validation and native installation can differ from the raw locked target. The extractor's selected locked edge records that source target; it is not an assertion of npm policy validity or installed presence.

The test checks exact native outcomes and verifies that extraction preserves raw lock records and platform conditions despite installation omission or failure. Native npm remains a useful development oracle; using native resolution or installation during ordinary lockfile scans would introduce tool-version, policy, cache and mutation requirements without turning a lock into an installed-tree observation. No runtime architecture change is made here.
