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

## Native result v2

All extractors return `formatVersion: 2`, preserving native dependency contexts for
packages with equal PURLs. Every package and project has a PURL, including versionless
identities when the input does not establish an exact package version. The default
exports and CLI use this format; exports ending in `V2` are aliases for the same APIs.

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

See the [result v2 contract](../analyzer-core/src/result-v2/README.md) for selection,
conditions and completeness. Fixture tests compare native records and requests
with the resulting graph, alongside focused tests for contextual reachability.
Correctness also requires evidence from native package-manager behavior.
