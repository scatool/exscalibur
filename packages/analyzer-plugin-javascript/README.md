# @scatool/analyzer-plugin-javascript

**Note**: This plugin is experimental.

JavaScript/TypeScript ecosystem analyzer plugin for Exscalibur.

## Requirements

None.

## Usage

```typescript
import { packageLockJsonExtractor } from "@scatool/analyzer-plugin-javascript";

const result = await packageLockJsonExtractor.extract("/path/to/codebase");
```

## Dependency observations

All extractors return `formatVersion: 2`, preserving native dependency contexts for
packages with equal PURLs. Every package and project has a PURL, including versionless
identities when the input does not establish an exact package version. The library
exports and CLI use this format.

```typescript
import { yarnBerryExtractor } from "@scatool/analyzer-plugin-javascript";

const result = await yarnBerryExtractor.extract("/path/to/codebase", undefined, {
  codebaseId: "https://github.com/example/project@exact-revision",
});
```

| Export                     | Native input                          |
| -------------------------- | ------------------------------------- |
| `packageLockJsonExtractor` | npm lock versions 1, 2 and 3          |
| `pnpmLockExtractor`        | pnpm lock versions 5, 6 and 9         |
| `packageJsonExtractor`     | Current manifest declarations         |
| `yarnLockExtractor`        | Yarn Classic lockfiles                |
| `yarnBerryExtractor`       | Modern Yarn lock versions 4 through 9 |
| `bunlockExtractor`         | Text Bun lock versions 0 through 3    |
| `denoLockExtractor`        | Deno lock versions 3, 4 and 5         |

Keep graph identities when querying dependencies. Catalog PURLs alone cannot
distinguish different peer contexts, workspace consumers or native package paths.
Current declarations and locked observations remain separate when they disagree.
All recorded platform alternatives remain available; the machine running extraction
does not establish where the software will be deployed.

### npm lock observations

The npm extractor reads lockfile placements and declarations; it does not run npm
installation or claim an installed tree. Separate placements retain separate views,
including when they have the same PURL. In lockfile versions 2 and 3, workspace consumers follow production
dependencies without importing the workspace's development roots.

Local manifest reads stay inside the scanned codebase, including resolved symlink
targets. Outside paths retain only their recorded lock metadata with a warning.
Their dependency candidates follow the source location's actual lexical ancestors,
not the scanned project's sibling `node_modules`; recorded external placements
remain usable without external filesystem reads.
Bindings from sources outside the lock root remain unknown lookup candidates:
native virtual loading does not establish those external contexts, even when a
lexically eligible target record is present. They do not produce a complete closure.
The [external-source oracle](./src/packagelockjson/external-source-oracle.mjs)
reproduces this boundary using source-authored locks and pinned offline Arborist.
Every link is checked even when unreachable from current roots: malformed flags,
destinations and cycles produce an extraction error; missing target records retain
available evidence with unknown project enumeration. Truncated or structurally
invalid lockfiles retain a failed observation rather than a successful empty graph.

Peer targets found through placement lookup are explicitly `unknown` candidates,
not verified peer bindings. A candidate can have an incompatible version or be a
child placement that npm rejects as a peer. Missing optional peers are excluded
from the recorded observation; missing ordinary optional dependencies remain
uncertain declarations. An optional dependency overrides the same-name ordinary
declaration, which remains recorded as excluded. Optional dependencies have their
own roots; a consumer selecting production scope policy should consider both
`dependencies` and `optionalDependencies`.

All locked platform alternatives remain in inventory. `os`, `cpu` and `libc` become
native conditions, without evaluating this machine's platform. npm omit settings,
failed optional installation and platform-specific installation can therefore
produce an installed tree different from the recorded lock graph.

Current `overrides` are retained as manifest metadata, not evaluated. A lockfile
does not necessarily record the override policy that produced it, so unchanged
declarations alone cannot establish compatibility with current overrides. Native
resolution is required to establish the effective overridden tree. Manifest/lock
drift detection compares dependency declarations, peer metadata and platform fields;
it is not a substitute for npm's lock validation.

Version 1 cannot establish workspace/local project roots from incomplete local
locator records. These observations report unknown root enumeration; local views
retain raw requests and lookup candidates with unknown adjacency and selection.
Ordinary archive records with artifact metadata do not imply missing project roots.
Missing manifests do not discard root coordinates recorded in the lockfile.

When shrinkwrap and package-lock coexist, both files remain independent source
observations. npm's preference for shrinkwrap does not erase the other file's facts;
the extractor does not claim both files were selected for an installation.

Pinned, offline native comparisons cover [peer placement and validation](./src/packagelockjson/__fixtures__/npm-peer-oracle/README.md)
and [optional dependencies, platforms and overrides](./src/packagelockjson/npm-optional-oracle.md),
plus [workspaces, links and aliases across lockfile versions](./src/packagelockjson/npm-workspace-oracle.md)
and [lock precedence and manifest changes](./src/packagelockjson/__fixtures__/npm-lock-selection-oracle/README.md).
These are development oracles; normal extraction does not invoke npm or Arborist.

### Other native observations

Yarn's raw graph retains merged workspace declarations. A second graph correlates
current manifest scopes with locked requests. Both expose a `raw-descriptor-map`
projection; they do not run Yarn's compatibility patches, overrides or plugin transforms
and do not claim effective resolver output. Unmatched requests remain uncertain,
and omitted virtual peer bindings are not reconstructed from same-name inventory.
Bun peers identified only by placement also remain uncertain. Missing or malformed
native package INFO has unknown adjacency; binary `.lockb` files produce an explicit
unsupported-input issue and unknown coverage.

Deno keeps native workspace roots separate from current JSONC imports and package
declarations. HTTP modules remain inventory unless entry-point evidence exists.
JSR dependency coverage remains unknown because lockfiles record retention information;
external import maps are retained as references without claiming complete declarations.

See the [result contract](../analyzer-core/src/result/README.md) for selection,
conditions and completeness. Fixture tests compare native records and requests
with the resulting graph, alongside focused tests for contextual reachability.
Correctness also requires evidence from native package-manager behavior.
