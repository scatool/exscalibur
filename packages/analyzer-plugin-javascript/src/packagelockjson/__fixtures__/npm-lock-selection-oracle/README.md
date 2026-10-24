# Offline npm lock selection

These seven controlled inputs distinguish raw lockfile observations from npm's
selected virtual tree. The capture records only selected filename, root identity,
root dependency edges, and native error codes; it does not duplicate the full tree.
It was produced with Node 22.23.4, npm 11.9.0, and bundled Arborist 9.2.0.

Reproduce from the repository root with those tools already installed:

```sh
node packages/analyzer-plugin-javascript/src/packagelockjson/npm-lock-selection-oracle.mjs "$NPM_PACKAGE_DIRECTORY"
```

The argument points to the directory containing npm's own `package.json`. The
default verifies the committed capture; `--write` intentionally replaces it.
Input bytes are SHA-256 checked. The generator only writes temporary fixture files
and invokes offline `loadVirtual`; it does not install, build an ideal tree, run
lifecycle scripts, or fetch packages. A stable `project` directory basename exposes
Arborist's fallback naming without recording an absolute environment path.

Observed distinctions:

- Coexisting valid files: npm selects shrinkwrap. Excalibur retains both independent
  locked observations and does not claim either is an installed or active graph.
- Stale manifest: npm uses the current root request against old locked placement,
  producing `INVALID`. Excalibur preserves locked requests and current declarations
  separately, with a mismatch warning.
- Missing or malformed manifest: npm can use lock root metadata. Excalibur also
  retains that data, and reports malformed manifest evidence explicitly.
- Missing root identity or root record: npm supplies the directory basename.
  Excalibur preserves the explicit top-level lock name/version instead. Native
  virtual normalization is not a substitute for raw source identity evidence.
- Malformed shrinkwrap plus valid package-lock: npm reports `ENOLOCK`, without
  falling through to the valid sibling. Excalibur retains the valid observation
  and a separate unknown failed-shrinkwrap observation with its extraction error.

The tests intentionally do not force parser output to equal npm's merged virtual
interpretation or discard evidence that npm does not select.
