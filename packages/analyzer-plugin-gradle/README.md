# @scatool/analyzer-plugin-gradle

Gradle plugin for Excalibur dependency analyzer.

This plugin uses the [GitHub Dependency Graph Gradle Plugin](https://github.com/gradle/github-dependency-graph-gradle-plugin) to extract comprehensive dependency information from Gradle projects.

## Requirements

- Gradle wrapper (`gradlew` or `gradlew.bat`) must be present in the project
- Java must be available (version depends on Gradle version)

## Usage

```typescript
import { gradleExtractor } from '@scatool/analyzer-plugin-gradle';

const result = await gradleExtractor.extract('/path/to/gradle/project');
```

## Testing

```bash
bun test           # Run all tests
bun run typecheck  # TypeScript type checking
```
