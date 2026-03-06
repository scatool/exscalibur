import { describe, expect, test } from 'bun:test';
import { findLineNumber, parseDenoLockfile, parseJsrPackage, parseNpmPackage } from './lockfile';

describe('parseDenoLockfile', () => {
  test('parses a valid lockfile', () => {
    const content = JSON.stringify({
      version: '3',
      packages: {
        specifiers: { 'npm:chalk@5': 'npm:chalk@5.3.0' },
        npm: { 'chalk@5.3.0': { integrity: 'sha256-abc', dependencies: {} } },
      },
    });
    const result = parseDenoLockfile(content);
    expect(result.version).toBe('3');
    expect(result.packages?.specifiers).toEqual({ 'npm:chalk@5': 'npm:chalk@5.3.0' });
  });

  test('throws on invalid JSON', () => {
    expect(() => parseDenoLockfile('{')).toThrow('Failed to parse Deno lockfile');
  });
});

describe('parseJsrPackage', () => {
  test('parses with jsr: prefix', () => {
    expect(parseJsrPackage('jsr:@std/path@0.224.0')).toEqual({
      scope: '@std',
      name: 'path',
      version: '0.224.0',
    });
  });

  test('parses without jsr: prefix', () => {
    expect(parseJsrPackage('@luca/flag@1.0.0')).toEqual({
      scope: '@luca',
      name: 'flag',
      version: '1.0.0',
    });
  });

  test('returns null for invalid input', () => {
    expect(parseJsrPackage('no-scope')).toBeNull();
    expect(parseJsrPackage('@scope/name')).toBeNull();
  });
});

describe('parseNpmPackage', () => {
  test('parses with npm: prefix', () => {
    expect(parseNpmPackage('npm:chalk@5.3.0')).toEqual({ name: 'chalk', version: '5.3.0' });
  });

  test('parses without npm: prefix', () => {
    expect(parseNpmPackage('express@4.18.2')).toEqual({ name: 'express', version: '4.18.2' });
  });

  test('parses scoped package', () => {
    expect(parseNpmPackage('@types/node@20.11.0')).toEqual({ name: '@types/node', version: '20.11.0' });
  });

  test('returns null for invalid input', () => {
    expect(parseNpmPackage('no-version')).toBeNull();
    expect(parseNpmPackage('@bare-scope')).toBeNull();
  });
});

describe('findLineNumber', () => {
  const content = 'line one\nline two\nline three';

  test('returns 1-based line number', () => {
    expect(findLineNumber(content, 'line one')).toBe(1);
    expect(findLineNumber(content, 'line three')).toBe(3);
  });

  test('returns undefined when not found', () => {
    expect(findLineNumber(content, 'missing')).toBeUndefined();
  });
});
