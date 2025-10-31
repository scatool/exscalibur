# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Excalibur extracts dependency graphs from software projects. It parses lockfiles, package manifests, and other dependency definition files to produce a normalized graph of:

- **Packages**: Dependencies with Package URLs (PURLs) and evidence (file paths + line numbers)
- **Subprojects**: Individual projects in a monorepo with their dependency scopes
- **Relationships**: Dependency edges between packages

## Commands

### Testing

- **Run all tests**: `bun test` (from root, uses Turbo)
- **Run tests for a specific package**: `cd packages/<package-name> && bun test`
- **Run a single test file**: `bun test <path-to-test-file>`
- **Update snapshots**: `bun test <path-to-test-file> --update-snapshots`

### Type Checking

- **Type check all packages**: `bun run typecheck` (from root, uses Turbo)
- **Type check a specific package**: `cd packages/<package-name> && bunx tsc --strict --noEmit`

### Linting and Formatting

- **Lint**: `bun run lint` (ESLint)
- **Format**: `bun run format` (Prettier)

### Package Management

- **Install dependencies**: `bun install`
- Uses Bun as the package manager (version 1.3.1)

## Architecture

### Core Types (`@scatool/analyzer-core`)

The core package defines the fundamental data structures:

- **`AnalyzerResult`**: Container for packages, subprojects, and relationships
- **`Package`**: A dependency with a PURL and evidence array (file paths with line numbers)
- **`Subproject`**: A project/workspace with dependency scopes (e.g., dependencies, devDependencies)
- **`Relationship`**: Directed edges from one package to others
- **`Extractor`**: Interface with `name`, `version`, and `extract(codebase)` method
- **`FilesExtractor`**: Higher-level interface that marks files then extracts them individually

### Extractor Pattern

All extractors follow a consistent pattern using `filesExtractor()` helper:

```typescript
export const extractor: Extractor = filesExtractor({
  name: 'extractor-name',
  version: 1,
  markFiles: async function (codebase: string) {
    // Glob for relevant files and call this.markFile(path)
  },
  extractFile: async (file: string): Promise<AnalyzerResult> {
    // Parse file and return AnalyzerResult
  },
});
```

**Key responsibilities**:

1. **`markFiles`**: Use Bun's `Glob` to find relevant files, excluding `node_modules`
2. **`extractFile`**: Parse individual files and return structured results
3. **Evidence tracking**: Record file path and line number for each package reference
4. **PURL creation**: Use `PackageURL` from `packageurl-js` to create normalized identifiers
5. **Relationship mapping**: Track dependencies between packages

### Result Normalization

The core provides `normalizeResult()` and `mergeResults()` utilities:

- **`normalizeResult()`**: Sorts packages, subprojects, relationships, and evidence arrays for deterministic output
- **`mergeResults()`**: Combines multiple `AnalyzerResult` objects, deduplicating packages and merging relationships

The `filesExtractor()` helper automatically calls `mergeResults()` on all file results.

### Plugin Structure

Each plugin package exports one or more extractors:

- **`@scatool/analyzer-plugin-javascript`**: npm ecosystem support
  - `bunlockExtractor`: Parses `bun.lock` (JSONC format)
  - `packageLockJsonExtractor`: Parses `package-lock.json` (with npm ls fallback)
  - `pnpmLockExtractor`: Parses `pnpm-lock.yaml` (supports v6 and v9+ formats)
  - `yarnLockExtractor`: Parses `yarn.lock` (with yarn list fallback)
  - `packageJsonExtractor`: Fallback parser for bare `package.json` files

- **`@scatool/analyzer-plugin-containers`**: Docker/OCI images
  - `dockerfileExtractor`: Extracts base images from Dockerfiles

- **`@scatool/analyzer-plugin-github-actions`**: GitHub Actions workflows
  - Extracts action references from `.github/workflows/*.{yml,yaml}`

- **`@scatool/analyzer-plugin-gradle`**: Gradle projects (in development)

### Testing Approach

Tests use Bun's test runner with snapshot testing:

- Fixtures in `__fixtures__/` subdirectories contain real-world examples
- Tests typically extract from fixtures and compare against snapshots
- Each extractor has comprehensive test coverage for different scenarios (basic, monorepo, workspace, git deps, tarball deps, etc.)
