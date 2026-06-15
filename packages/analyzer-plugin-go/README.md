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
