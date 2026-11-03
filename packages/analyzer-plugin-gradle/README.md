# @scatool/analyzer-plugin-gradle

**Note**: This plugin is experimental.

Gradle ecosystem analyzer plugin for Exscalibur.

This plugin uses the [GitHub Dependency Graph Gradle Plugin](https://github.com/gradle/github-dependency-graph-gradle-plugin) to extract configuration-specific component snapshots from Gradle projects.

## Requirements

- Gradle wrapper (`gradlew` or `gradlew.bat`) must be present in the project
- Java must be available (version depends on Gradle version)

## Usage

```typescript
import { gradleExtractor } from "@scatool/analyzer-plugin-gradle";

const result = await gradleExtractor.extract("/path/to/codebase");
```

## Result semantics

The default extractor returns format 2. Each native configuration snapshot is an
independent observation with its native node IDs. The snapshot is a component
projection: it does not prove effective variant graph equivalence, complete unresolved
declaration coverage or runtime usage. Variant and adjacency coverage remain unknown,
including for empty snapshots. A reported reference to a missing node is retained as
an unresolved dependency. Native extraction failures produce an error and an
unknown-coverage observation.

Tests exercise native Gradle commands and compare fixture declarations, runtime/test
scope separation and consumed-project transitivity. Converter tests cover contextual
IDs and missing-target preservation. Passing converter tests alone does not establish
successful native Gradle execution.
