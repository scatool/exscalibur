# @scatool/analyzer-plugin-maven

**Note**: This plugin is experimental.

Maven ecosystem analyzer plugin for Exscalibur.

This plugin uses Maven's `dependency:tree` command to extract comprehensive dependency information from Maven projects, including both direct and transitive dependencies.

## Requirements

- Maven wrapper (`mvnw` or `mvnw.cmd`) or Maven (`mvn`) must be available
- Java must be installed (version depends on project requirements)

## Usage

```typescript
import { mavenExtractor } from "@scatool/analyzer-plugin-maven";

const result = await mavenExtractor.extract("/path/to/codebase");
```
