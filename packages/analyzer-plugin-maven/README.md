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

## Result semantics

The default extractor returns format 2. Every selected dependency-tree occurrence has
its own view, preserving path-specific exclusions and mediation without unioning
adjacency by coordinates. Classifier and non-default artifact type remain in package
identity. Native scopes and optional flags are retained; the tree does not report the
original requested version ranges, so these are not invented from selected versions.

Each POM is analyzed non-recursively with a separate temporary output file. Reactor
artifacts needed by sibling modules must be resolvable in the local or configured
repository; otherwise extraction retains an error and unknown coverage. The native
multimodule test prepares its fixture reactor explicitly rather than relying on an
existing local cache. A successful empty tree still records its project and an empty
`maven:dependency-tree` root.
