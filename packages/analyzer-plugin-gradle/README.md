# @scatool/analyzer-plugin-gradle

**Note**: This plugin is experimental.

Gradle ecosystem analyzer plugin for Excalibur.

This plugin uses the [GitHub Dependency Graph Gradle Plugin](https://github.com/gradle/github-dependency-graph-gradle-plugin) to extract comprehensive dependency information from Gradle projects.

## Requirements

- Gradle wrapper (`gradlew` or `gradlew.bat`) must be present in the project
- Java must be available (version depends on Gradle version)

## Usage

```typescript
import { gradleExtractor } from "@scatool/analyzer-plugin-gradle";

const result = await gradleExtractor.extract("/path/to/codebase");
```
