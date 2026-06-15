# @scatool/analyzer-plugin-uv

**Note**: This plugin is experimental.

Python (uv) ecosystem analyzer plugin for Exscalibur.

This plugin runs `uv export --format cyclonedx1.5` to produce a CycloneDX SBOM, then extracts packages and relationships from the resulting JSON.

## Requirements

- [uv](https://docs.astral.sh/uv/) must be installed and available on `PATH` (or configured via `uvPath` option)
- A valid `uv.lock` file must be present in the project

## Usage

```typescript
import { extractor as uvExtractor } from "@scatool/analyzer-plugin-uv";

const result = await uvExtractor.extract("/path/to/codebase");
```
