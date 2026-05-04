import { describe, expect, test } from 'bun:test';
import { createVcpkgPurl, normalizeVcpkgName } from './utils.ts';

describe('createVcpkgPurl', () => {
  test('creates PURL with name and version', () => {
    expect(createVcpkgPurl('zlib', '1.2.11')).toBe('pkg:vcpkg/zlib@1.2.11');
  });

  test('normalizes package name to lowercase', () => {
    expect(createVcpkgPurl('OpenSSL', '3.0.0')).toBe('pkg:vcpkg/openssl@3.0.0');
    expect(createVcpkgPurl('ZLIB', '1.2.11')).toBe('pkg:vcpkg/zlib@1.2.11');
  });

  test('adds local qualifier when local flag is true', () => {
    expect(createVcpkgPurl('mypkg', '1.2.0', true)).toBe('pkg:vcpkg/mypkg@1.2.0?local=true');
  });

  test('omits local qualifier when not specified', () => {
    expect(createVcpkgPurl('boost', '1.78.0')).toBe('pkg:vcpkg/boost@1.78.0');
    expect(createVcpkgPurl('boost', '1.78.0', false)).toBe('pkg:vcpkg/boost@1.78.0');
  });

  test('handles package names with hyphens and numbers', () => {
    expect(createVcpkgPurl('cli11', '2.0.0')).toBe('pkg:vcpkg/cli11@2.0.0');
    expect(createVcpkgPurl('some-lib', '1.0.0')).toBe('pkg:vcpkg/some-lib@1.0.0');
  });
});

describe('normalizeVcpkgName', () => {
  test('converts to lowercase', () => {
    expect(normalizeVcpkgName('OpenSSL')).toBe('openssl');
    expect(normalizeVcpkgName('ZLIB')).toBe('zlib');
  });

  test('preserves lowercase names', () => {
    expect(normalizeVcpkgName('openssl')).toBe('openssl');
    expect(normalizeVcpkgName('curl')).toBe('curl');
  });

  test('preserves hyphens and numbers', () => {
    expect(normalizeVcpkgName('CLI11')).toBe('cli11');
    expect(normalizeVcpkgName('some-lib')).toBe('some-lib');
    expect(normalizeVcpkgName('Some-Lib-123')).toBe('some-lib-123');
  });

  test('handles mixed case with special characters', () => {
    expect(normalizeVcpkgName('OpenSSL-Dev')).toBe('openssl-dev');
    expect(normalizeVcpkgName('BOOST_System')).toBe('boost_system');
  });
});
