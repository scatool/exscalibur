# Offline npm peer oracle

`inputs.json` contains nine controlled package-placement trees. They are native npm
package-lock version 3 inputs, constructed to isolate peer lookup and validation.
`native-output.json` records every dependency edge returned by npm 11.9.0's bundled
Arborist 9.2.0, running on Node 22.23.4. The capture includes the SHA-256 of the input
file and preserves native edge type, target, validity, and error independently of
Excalibur's interpretation.

From the repository root, with these exact tools already installed:

```sh
node packages/analyzer-plugin-javascript/src/packagelockjson/npm-peer-oracle.mjs "$NPM_PACKAGE_DIRECTORY"
```

Set `NPM_PACKAGE_DIRECTORY` to the installed directory containing npm's own
`package.json` and bundled dependencies. No environment-specific path is recorded.
The default command compares freshly read native results with the committed capture.
Append `--write` only to intentionally replace the capture after reviewing a change.
Input formatting changes its SHA-256 and requires refreshing that capture.

The generator creates temporary `package-lock.json` and package manifests, invokes
`loadVirtual` and `loadActual` independently, and deletes its temporary tree. It does
not install packages or invoke `buildIdealTree`, `reify`, registry access, lifecycle
scripts, or audit. `loadActual` inspects a controlled filesystem tree whose manifests
were written by the generator; it is not evidence of a successful npm installation.
Native validation errors are edge properties, not thrown installation failures.
Both native readers agree for every case in this matrix.

| Case                    | Native peer result                                                               |
| ----------------------- | -------------------------------------------------------------------------------- |
| Hoisted valid           | Valid ancestor candidate                                                         |
| Nested valid            | Two identical widget versions retain different valid ancestor peers              |
| Hoisted conflict        | Candidate remains present, `INVALID`                                             |
| Optional present        | Valid candidate, `peerOptional`                                                  |
| Optional absent         | No candidate; valid optional omission                                            |
| Required absent         | No candidate, `MISSING`                                                          |
| Child candidate invalid | Compatible child shadows compatible ancestor, `PEER LOCAL`; no ancestor fallback |
| Optional conflict       | Present optional peer is still `INVALID` when incompatible                       |
| Root peer valid         | Root's own child can satisfy its peer; no `PEER LOCAL` error                     |

The accompanying test compares Excalibur's candidate locations and requests with
these native outputs. Existing extraction keeps present peers as resolved lookup
candidates with unknown selection, missing required peers as declared/unknown, and
missing optional peers as declared/excluded. It does not assert that a lookup
candidate satisfies npm peer validation. Native `INVALID`, `PEER LOCAL`, and
`MISSING` diagnostics are captured here but are not currently emitted as extractor
issues. No production behavior changes are included in this oracle.
