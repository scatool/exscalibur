import { describe, expect, test } from 'bun:test';
import { CARGO_DEPENDENCY_SCOPES, createCargoPurl } from './cargo-utils.ts';

describe('CARGO_DEPENDENCY_SCOPES', () => {
  test('contains expected scopes', () => {
    expect(CARGO_DEPENDENCY_SCOPES).toEqual(['dependencies']);
  });
});

describe('createCargoPurl', () => {
  test('creates PURL for simple package', () => {
    const purl = createCargoPurl('serde', '1.0.193');
    expect(purl).toBe('pkg:cargo/serde@1.0.193');
  });

  test('creates PURL for package with hyphen', () => {
    const purl = createCargoPurl('serde-json', '1.0.108');
    expect(purl).toBe('pkg:cargo/serde-json@1.0.108');
  });

  test('creates PURL for package with underscore', () => {
    const purl = createCargoPurl('my_package', '0.1.0');
    expect(purl).toBe('pkg:cargo/my_package@0.1.0');
  });

  test('creates PURL with prerelease version', () => {
    const purl = createCargoPurl('tokio', '1.0.0-beta.1');
    expect(purl).toBe('pkg:cargo/tokio@1.0.0-beta.1');
  });

  test('creates PURL with build metadata', () => {
    const purl = createCargoPurl('mylib', '1.0.0+20130313144700');
    expect(purl).toBe('pkg:cargo/mylib@1.0.0+20130313144700');
  });
});
