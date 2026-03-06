import { describe, expect, test } from 'bun:test';
import { convertOrtIdToPurl } from './id.ts';

describe('convertOrtIdToPurl', () => {
  test('converts NPM package without namespace', () => {
    expect(convertOrtIdToPurl('NPM::lodash:4.17.21')).toBe('pkg:npm/lodash@4.17.21');
  });

  test('converts Maven package with namespace', () => {
    expect(convertOrtIdToPurl('Maven:org.example:my-lib:1.0.0')).toBe('pkg:maven/org.example/my-lib@1.0.0');
  });

  test('converts PyPI package', () => {
    expect(convertOrtIdToPurl('PyPI::requests:2.31.0')).toBe('pkg:pypi/requests@2.31.0');
  });

  test('converts Go package', () => {
    expect(convertOrtIdToPurl('Go::github.com/pkg/errors:0.9.1')).toBe('pkg:golang/github.com%2Fpkg%2Ferrors@0.9.1');
  });

  test('converts GoMod to golang type', () => {
    expect(convertOrtIdToPurl('GoMod::golang.org/x/text:0.14.0')).toBe('pkg:golang/golang.org%2Fx%2Ftext@0.14.0');
  });

  test('converts Gradle to maven type', () => {
    expect(convertOrtIdToPurl('Gradle:com.google:gson:2.10.1')).toBe('pkg:maven/com.google/gson@2.10.1');
  });

  test('returns id as-is for invalid format', () => {
    expect(convertOrtIdToPurl('invalid')).toBe('invalid');
  });
});
