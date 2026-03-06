import { describe, expect, test } from 'bun:test';
import { parsePackagePattern, resolvePackageVersion, findLineNumber, parseYarnBerryLockfile } from './lockfile.ts';

describe('parsePackagePattern', () => {
  test('parses npm package', () => {
    expect(parsePackagePattern('lodash@npm:^4.17.21')).toEqual({
      name: 'lodash',
      type: 'npm',
      versionOrPath: '^4.17.21',
    });
  });

  test('parses scoped npm package', () => {
    expect(parsePackagePattern('@babel/core@npm:^7.0.0')).toEqual({
      name: '@babel/core',
      type: 'npm',
      versionOrPath: '^7.0.0',
    });
  });

  test('parses workspace package', () => {
    expect(parsePackagePattern('@scatest/ui@workspace:packages/ui')).toEqual({
      name: '@scatest/ui',
      type: 'workspace',
      versionOrPath: 'packages/ui',
    });
  });

  test('parses npm alias', () => {
    expect(parsePackagePattern('react-16@npm:react@^16.0.0')).toEqual({
      name: 'react',
      type: 'npm-alias',
      versionOrPath: '^16.0.0',
      alias: 'react-16',
    });
  });

  test('parses git package', () => {
    expect(parsePackagePattern('express@https://github.com/expressjs/express')).toEqual({
      name: 'express',
      type: 'git',
      versionOrPath: 'https://github.com/expressjs/express',
    });
  });

  test('parses patch package', () => {
    expect(parsePackagePattern('lodash@patch:lodash@^4.17.21#./my-patch.patch')).toEqual({
      name: 'lodash',
      type: 'patch',
      versionOrPath: 'lodash@^4.17.21#./my-patch.patch',
    });
  });

  test('parses link package', () => {
    expect(parsePackagePattern('my-lib@link:../my-lib')).toEqual({
      name: 'my-lib',
      type: 'link',
      versionOrPath: '../my-lib',
    });
  });

  test('parses portal package', () => {
    expect(parsePackagePattern('my-lib@portal:../my-lib')).toEqual({
      name: 'my-lib',
      type: 'portal',
      versionOrPath: '../my-lib',
    });
  });

  test('returns null for invalid pattern', () => {
    expect(parsePackagePattern('invalid')).toBeNull();
  });
});

describe('findLineNumber', () => {
  test('finds quoted package key', () => {
    const content = '"@babel/core@npm:^7.0.0":\n  version: 7.23.9\n  resolution: "@babel/core@npm:7.23.9"';
    expect(findLineNumber(content, '@babel/core@npm:^7.0.0')).toBe(1);
  });

  test('finds package key on later line', () => {
    const content = '__metadata:\n  version: 8\n\n"lodash@npm:^4.17.21":\n  version: 4.17.21';
    expect(findLineNumber(content, 'lodash@npm:^4.17.21')).toBe(4);
  });

  test('returns undefined for missing key', () => {
    const content = '"lodash@npm:^4.17.21":\n  version: 4.17.21';
    expect(findLineNumber(content, 'react@npm:^18.0.0')).toBeUndefined();
  });
});

describe('resolvePackageVersion', () => {
  test('resolves via npm: protocol exact match', () => {
    const lockfile = parseYarnBerryLockfile(['"lodash@npm:^4.17.21":', '  version: 4.17.21', ''].join('\n'));
    expect(resolvePackageVersion(lockfile, 'lodash', '^4.17.21')).toBe('4.17.21');
  });

  test('strips npm: prefix from version range', () => {
    const lockfile = parseYarnBerryLockfile(['"lodash@npm:^4.17.21":', '  version: 4.17.21', ''].join('\n'));
    expect(resolvePackageVersion(lockfile, 'lodash', 'npm:^4.17.21')).toBe('4.17.21');
  });

  test('skips workspace packages (0.0.0-use.local)', () => {
    const lockfile = parseYarnBerryLockfile(['"my-app@workspace:.":', '  version: 0.0.0-use.local', ''].join('\n'));
    expect(resolvePackageVersion(lockfile, 'my-app', 'workspace:.')).toBeNull();
  });

  test('falls back to searching all entries by package name', () => {
    const lockfile = parseYarnBerryLockfile(['"react@npm:^18.0.0":', '  version: 18.2.0', ''].join('\n'));
    // Different range than what's in the lockfile, triggers fallback search
    expect(resolvePackageVersion(lockfile, 'react', '^18.2.0')).toBe('18.2.0');
  });

  test('returns null when package not found', () => {
    const lockfile = parseYarnBerryLockfile(['"lodash@npm:^4.17.21":', '  version: 4.17.21', ''].join('\n'));
    expect(resolvePackageVersion(lockfile, 'nonexistent', '^1.0.0')).toBeNull();
  });
});

describe('parseYarnBerryLockfile', () => {
  test('parses metadata', () => {
    const content = ['__metadata:', '  version: 8', '  cacheKey: 10c0', ''].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    expect(lockfile.version).toBe(8);
    expect(lockfile.cacheKey).toBe('10c0');
  });

  test('parses a single package entry', () => {
    const content = [
      '"lodash@npm:^4.17.21":',
      '  version: 4.17.21',
      '  resolution: "lodash@npm:4.17.21"',
      '  checksum: abc123',
      '  linkType: hard',
      '  languageName: node',
      '',
    ].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    const pkg = lockfile.packages.get('lodash@npm:^4.17.21');
    expect(pkg).toBeDefined();
    expect(pkg!.version).toBe('4.17.21');
    expect(pkg!.resolution).toBe('lodash@npm:4.17.21');
    expect(pkg!.checksum).toBe('abc123');
    expect(pkg!.linkType).toBe('hard');
    expect(pkg!.languageName).toBe('node');
  });

  test('parses multiple patterns (comma-separated key)', () => {
    const content = [
      '"@scatest/ui@npm:*, @scatest/ui@workspace:packages/ui":',
      '  version: 0.0.0-use.local',
      '  linkType: soft',
      '',
    ].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    expect(lockfile.packages.get('@scatest/ui@npm:*')).toBeDefined();
    expect(lockfile.packages.get('@scatest/ui@workspace:packages/ui')).toBeDefined();
    // Both patterns point to the same entry
    expect(lockfile.packages.get('@scatest/ui@npm:*')!.version).toBe('0.0.0-use.local');
  });

  test('parses dependencies', () => {
    const content = [
      '"express@npm:^4.18.0":',
      '  version: 4.18.2',
      '  dependencies:',
      '    accepts: ~1.3.8',
      '    body-parser: 1.20.1',
      '  optionalDependencies:',
      '    debug: 2.6.9',
      '  peerDependencies:',
      '    node: ">=14"',
      '',
    ].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    const pkg = lockfile.packages.get('express@npm:^4.18.0');
    expect(pkg!.dependencies).toEqual({ accepts: '~1.3.8', 'body-parser': '1.20.1' });
    expect(pkg!.optionalDependencies).toEqual({ debug: '2.6.9' });
    expect(pkg!.peerDependencies).toEqual({ node: '>=14' });
  });

  test('parses scoped dependencies', () => {
    const content = [
      '"my-app@workspace:.":',
      '  version: 0.0.0-use.local',
      '  dependencies:',
      '    "@babel/core": npm:^7.0.0',
      '',
    ].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    const pkg = lockfile.packages.get('my-app@workspace:.');
    expect(pkg!.dependencies).toEqual({ '@babel/core': 'npm:^7.0.0' });
  });

  test('parses multiple package entries', () => {
    const content = [
      '"lodash@npm:^4.17.21":',
      '  version: 4.17.21',
      '',
      '"react@npm:^18.0.0":',
      '  version: 18.2.0',
      '',
    ].join('\n');
    const lockfile = parseYarnBerryLockfile(content);
    expect(lockfile.packages.size).toBe(2);
    expect(lockfile.packages.get('lodash@npm:^4.17.21')!.version).toBe('4.17.21');
    expect(lockfile.packages.get('react@npm:^18.0.0')!.version).toBe('18.2.0');
  });

  test('stores originalPattern on parsed entries', () => {
    const content = ['"@scatest/ui@npm:*, @scatest/ui@workspace:packages/ui":', '  version: 0.0.0-use.local', ''].join(
      '\n',
    );
    const lockfile = parseYarnBerryLockfile(content);
    const pkg = lockfile.packages.get('@scatest/ui@npm:*');
    expect(pkg!.originalPattern).toBe('@scatest/ui@npm:*, @scatest/ui@workspace:packages/ui');
  });
});
