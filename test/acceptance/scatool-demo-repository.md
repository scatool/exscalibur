# scatool/demo-repository acceptance

Reviewed input is commit `6f753a2b9f41332c074d48204fb63de3a471e76d`, tree
`f3599538b188bba6254fa4111092f83863d215a3`. The downloader verified the requested
commit before exporting its tree through Git; the source archive SHA-256 is
`402937595f519d6cc799912515a68f4c64f4b13c6232868314c9f834e6688391`.
The complete exported tree contains six files, with no nested manifests or lockfiles.

| Input                 | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `package.json`        | `08236514f628afb66d9796bbbfdd245270e986eddad799e9db9871010c506630` |
| `npm-shrinkwrap.json` | `5c47d7b1483bdb66426f0f6255461fc1b4e8d9f9f8ca708bf09d8ecd7a3dc5dd` |

Extraction used Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. All sixteen
extractors configured in `integration.test.ts` ran with the configured empty options
and stable codebase namespace for this pin. Only `packagelockjson` produced an
observation. No package installation, dependency download or resolver invocation
was used to construct or validate this baseline.

## Source comparison

The manifest identifies `demo-repository@1.0.0` and declares only `axios: ^1.3.5`.
The npm shrinkwrap uses native lockfile version 1 and contains nine top-level
package records, with no nested placements. This lockfile version is a supported
input format; the analyzer result remains wire format 2.

All nine catalog identities and view locations match those source records. Each
artifact location and integrity string matches the corresponding shrinkwrap entry.
Every native `requires` entry is represented by a selected, resolved edge with its
original name and specifier: three from axios, three from form-data, one from
combined-stream, and one from mime-types. The five remaining package records have
complete empty adjacency. No extra package edges were admitted.

The exact project owns four scope roots. There are fourteen views: nine package
views, four scope views, and one consumer view. There are ten edges: eight native
package edges plus two candidate axios bindings, from the dependency scope and the
consumer view. Both candidate bindings retain **unknown selection**, since this
lockfile does not record the root declaration list and cannot establish that the
current manifest was used to produce the lock. The other three manifest scopes
contain no requests.

A dependency query therefore returns all nine packages as conditional members,
no definite members, no unresolved declarations, and partial closure completeness.
The three empty scopes have complete empty closures. All artifact, project, root,
edge and query assertions are executable in `test/demo-acceptance.test.ts`.
The result contains no extraction issues.

## Acceptance limits

This verifies agreement with the pinned manifest and recorded shrinkwrap topology,
including conservative correlation of current declarations. It does not claim
that a fresh npm run would select these versions, that dependencies are installed,
or that they occur in a deployed artifact. The obsolete PURL-union baseline was
not used as a semantic oracle.
