# @scatool/analyzer-plugin-go

Excalibur plugin for extracting dependency information from Go projects using Go modules.

## Features

- Parses `go.mod` files to extract module dependencies
- Distinguishes between direct and indirect dependencies
- Handles `replace` directives (excluding local path replacements)
- Extracts subproject information for each Go module
- Records evidence (file paths and line numbers) for all dependencies
- Supports monorepo structures with multiple Go modules

## Extractors

### `gomodExtractor`

Extracts dependencies from Go module files (`go.mod`).

**Files processed:**

- `**/go.mod` (excluding vendor and cache directories)

**Dependency scopes:**

- `dependencies`: Direct dependencies (from `require` blocks without `// indirect` comment)
- `indirectDependencies`: Indirect/transitive dependencies (marked with `// indirect` comment)

**PURL format:**

- Uses `pkg:golang/` scheme
- Full module path as the package name (e.g., `pkg:golang/github.com/gin-gonic/gin@1.9.1`)

## Limitations

1. **Local replace directives**: Dependencies replaced with local paths (e.g., `replace foo => ./local/foo`) are currently excluded from the dependency graph, as they represent local development dependencies not published to a registry.

2. **Version resolution**: The module itself is assigned a pseudo-version (`0.0.0-00010101000000-000000000000`) since Go modules don't have intrinsic versions until published or tagged. The actual version would come from git tags or registry metadata.

3. **go.sum not used**: Currently only parses `go.mod` files. The `go.sum` file (which contains checksums) is not processed, though it could be used for additional verification in the future.

4. **Retracted versions**: The extractor does not currently check for or flag retracted module versions.

5. **Build constraints**: Go build tags and constraints are not evaluated, so dependencies that are conditionally included based on OS, architecture, or custom build tags are treated as always required.

6. **Relationship inference**: The extractor creates relationships between the module and its direct/indirect dependencies, but does not infer the complete transitive dependency graph (i.e., which dependencies depend on which other dependencies). This would require parsing all referenced modules' `go.mod` files.

## Usage

```typescript
import { gomodExtractor } from '@scatool/analyzer-plugin-go';

const result = await gomodExtractor.extract('/path/to/go/project');
console.log(result.packages); // All Go packages
console.log(result.subprojects); // Go modules with their dependencies
console.log(result.relationships); // Module -> dependency relationships
```

## Testing

Run tests:

```bash
bun test
```

Update test snapshots:

```bash
bun test --update-snapshots
```

Type check:

```bash
bun run typecheck
```
