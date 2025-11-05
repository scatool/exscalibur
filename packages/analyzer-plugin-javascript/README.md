# @scatool/analyzer-plugin-javascript

JavaScript/TypeScript ecosystem analyzer plugin for Excalibur.

## Extractors

This package provides extractors for various JavaScript/TypeScript package managers and runtimes:

- **bunlockExtractor**: Parses `bun.lock` files (JSONC format)
- **denoLockExtractor**: Parses `deno.lock` files (JSON format)
- **packageLockJsonExtractor**: Parses `package-lock.json` files (with npm ls fallback)
- **pnpmLockExtractor**: Parses `pnpm-lock.yaml` files (supports v6 and v9+ formats)
- **yarnBerryExtractor**: Parses Yarn Berry lockfiles
- **yarnLockExtractor**: Parses `yarn.lock` files (with yarn list fallback)
- **packageJsonExtractor**: Fallback parser for bare `package.json` files

## Deno Extractor Limitations

The Deno lockfile extractor (`denoLockExtractor`) has the following limitations:

- **Version Support**: Only supports lockfile version 3 and above (Deno 1.28+)
- **Remote Dependencies**: HTTPS URLs in the `remote` section are tracked with integrity hashes but not extracted as packages in the dependency graph
- **Workspace Support**: Partial workspace support - requires `deno.json` or `deno.jsonc` with workspace configuration
- **Subproject Detection**: Subprojects are only detected if a `deno.json` or `deno.jsonc` file exists in the same directory as `deno.lock`
- **Package Types**:
  - JSR packages are extracted with type `jsr`
  - npm packages are extracted with type `npm`
  - Remote HTTPS dependencies are not included in the package list
- **Import Maps**: Only top-level `imports` in `deno.json` are processed for subproject dependency scopes
