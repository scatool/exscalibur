# @scatool/analyzer-plugin-go

**Note**: This plugin is experimental.

Go ecosystem analyzer plugin for Exscalibur.

## Requirements

- Go v1.25 or higher (should be at least the version required by the project)

## Usage

```typescript
import { gomodExtractor } from "@scatool/analyzer-plugin-go";

const result = await gomodExtractor.extract("/path/to/codebase");
```

## Result semantics

The default extractor returns format 2. Native `go list -m -json all` selects module
versions; `go mod graph` retains requirement versions separately from those selected
bindings. Direct and indirect manifest roots remain distinct from the `go:build-list`
root. These are module dependencies, not a package import graph or a claim of runtime
use. Pruned module graphs do not establish complete adjacency, so selected module
views retain unknown coverage. Local replacement locations and native module metadata
remain attached to their views. Command failures retain unknown coverage and errors.
