# @scatool/analyzer-plugin-rust

Rust dependency analyzer plugin for Excalibur. Extracts dependency graphs from Rust projects using Cargo.lock files.

## Features

- **Cargo.lock parsing**: Extracts packages and relationships from Cargo.lock files (TOML format)
- **Workspace support**: Handles both single-package projects and Cargo workspaces
- **Complete dependency graph**: Tracks relationships between all packages
- **Evidence tracking**: Records file paths and line numbers for each package reference
- **PURL support**: Creates Package URLs (PURLs) with the `cargo` namespace

## Extractors

### `cargoLockExtractor`

Parses `Cargo.lock` files to extract dependency information.

**Pattern**: `**/Cargo.lock` (excluding files in `/target/` directories)

**What it extracts**:

- All packages with their versions
- Direct and transitive dependencies
- Subprojects (workspace members or root package)
- Dependency relationships

**Example PURL**: `pkg:cargo/serde@1.0.193`

## Limitations

1. **Dependency types**: Cargo.lock does not distinguish between dependency types (dependencies, dev-dependencies, build-dependencies). All dependencies are reported in a single "dependencies" scope for each subproject.

2. **Features**: Cargo feature flags are not tracked. The extractor reports all packages in the lockfile regardless of which features are enabled.

3. **Target-specific dependencies**: Platform-specific dependencies (e.g., `[target.'cfg(windows)'.dependencies]`) are included without conditional information. The extractor reports all packages that appear in the lockfile.

4. **Git and path dependencies**:
   - Git dependencies are resolved by version if available in the lockfile
   - Path dependencies (workspace members) are included with their versions
   - The source URL or path is not preserved in the PURL

5. **Patch and replace directives**: Cargo's `[patch]` and `[replace]` sections are not explicitly tracked. The extractor uses the resolved versions from the lockfile.

6. **Build artifacts**: The extractor automatically skips `Cargo.lock` files in `/target/` directories (Cargo's build output).

7. **Multiple versions**: When a project depends on multiple versions of the same crate, all versions are included with their respective relationships.

## Testing

Run tests with:

```bash
bun test
```

Run type checking with:

```bash
bun run typecheck
```
