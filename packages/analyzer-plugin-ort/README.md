# @scatool/analyzer-plugin-ort

**Note**: This plugin is experimental.

Converts OSS Review Toolkit (ORT) analyzer results.

## Requirements

None.

## Usage

```typescript
import { ortExtractor } from "@scatool/analyzer-plugin-ort";

const result = await ortExtractor.extract("/path/to/codebase");
```

The default API returns format 2. `convertOrtResult(source, { codebase, evidenceFile })`
preserves native dependency contexts and exact project scopes. An optional
`definitionFilePrefix` rebases reported project paths; evidence names the imported
report. The removed `useDefinitionFilePaths` option is not accepted.
