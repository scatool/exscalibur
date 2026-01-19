# @scatool/analyzer-plugin-javascript

**Note**: This plugin is experimental.

JavaScript/TypeScript ecosystem analyzer plugin for Excalibur.

## Requirements

None.

## Usage

```typescript
import { packageLockJsonExtractor } from '@scatool/analyzer-plugin-javascript';

const result = await packageLockJsonExtractor.extract('/path/to/codebase');
```
