# @scatool/analyzer-test-utils

Test utilities for analyzer plugins to reduce code duplication and improve test maintainability.

## Functions

### `normalizeResult(result, basePath, replacement = '<fixtures>')`

Normalizes paths in an `AnalyzerResult` for snapshot testing by replacing a base path with a placeholder.

- Mutates the result object in place
- Replaces paths in:
  - `package.evidence` arrays
  - `subproject.definitionFile` paths
- Returns the normalized result for convenience

**Example:**

```typescript
import { normalizeResult } from '@scatool/analyzer-test-utils';

const result = await extractor.extract(fixturePath);
normalizeResult(result, fixturesDir);
expect(result).toMatchSnapshot();
```

### `scanFixtures(fixturesDir, pattern)`

Scans a fixtures directory for subdirectories containing files matching a glob pattern.

- Returns a sorted array of directory names
- Useful for auto-discovering test fixtures

**Example:**

```typescript
import { scanFixtures } from '@scatool/analyzer-test-utils';

const fixtures = await scanFixtures(fixturesDir, '*/bun.lock');
// Returns: ['basic', 'monorepo', 'workspace']

for (const dir of fixtures) {
  test(dir, async () => {
    // ... test code
  });
}
```

### `scanFixtureFiles(fixturesDir, pattern)`

Scans a fixtures directory for files matching a glob pattern.

- Returns a sorted array of file paths
- Unlike `scanFixtures`, returns file paths instead of directory names

**Example:**

```typescript
import { scanFixtureFiles } from '@scatool/analyzer-test-utils';

const files = await scanFixtureFiles(fixturesDir, 'Dockerfile.*');
// Returns: ['Dockerfile.alpine', 'Dockerfile.multi-stage']

for (const file of files) {
  test(file, async () => {
    // ... test code
  });
}
```

## Migration Guide

### Before

```typescript
import { Glob } from 'bun';

const fixturesDir = `${import.meta.dir}/__fixtures__`;
const glob = new Glob('*/bun.lock');
const fixtures: string[] = [];

for await (const file of glob.scan({ cwd: fixturesDir })) {
  const dir = file.split('/')[0];
  if (dir) {
    fixtures.push(dir);
  }
}
fixtures.sort();

for (const dir of fixtures) {
  test(dir, async () => {
    const result = await extractor.extract(fixturePath);

    for (const pkg of result.packages) {
      pkg.evidence = pkg.evidence.map((e) => e.replace(fixturesDir, '<fixtures>'));
    }
    for (const subproject of result.subprojects) {
      subproject.definitionFile = subproject.definitionFile.replace(fixturesDir, '<fixtures>');
    }

    expect(result).toMatchSnapshot();
  });
}
```

### After

```typescript
import { normalizeResult, scanFixtures } from '@scatool/analyzer-test-utils';

const fixturesDir = `${import.meta.dir}/__fixtures__`;
const fixtures = await scanFixtures(fixturesDir, '*/bun.lock');

for (const dir of fixtures) {
  test(dir, async () => {
    const result = await extractor.extract(fixturePath);
    normalizeResult(result, fixturesDir);
    expect(result).toMatchSnapshot();
  });
}
```
