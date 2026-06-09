# @scatool/analyzer-plugin-rust

**Note**: This plugin is experimental.

Rust (Cargo) dependency analyzer plugin for Excalibur.

## Requirements

- `Cargo.lock` file must be present in the project
- `Cargo.toml` file is used to identify workspace members and subprojects

No external tools (Cargo, Rust) are required - the plugin parses lockfiles directly.

## Usage

```typescript
import { cargoLockExtractor } from "@scatool/analyzer-plugin-rust";

const result = await cargoLockExtractor.extract("/path/to/codebase");
```

## Limitations

1. **Dependency types**: Cargo.lock does not distinguish between dependency types (dependencies, dev-dependencies, build-dependencies). All dependencies are reported in a single "dependencies" scope for each subproject.

2. **Features**: Cargo feature flags are not tracked. The extractor reports all packages in the lockfile regardless of which features are enabled.

3. **Target-specific dependencies**: Platform-specific dependencies (e.g., `[target.'cfg(windows)'.dependencies]`) are included without conditional information. The extractor reports all packages that appear in the lockfile.

4. **Git and path dependencies**:
   - Git dependencies are resolved by version if available in the lockfile
   - Path dependencies (workspace members) are included with their versions
   - The source URL or path is not preserved in the PURL

5. **Patch and replace directives**: Cargo's `[patch]` and `[replace]` sections are not explicitly tracked. The extractor uses the resolved versions from the lockfile.
