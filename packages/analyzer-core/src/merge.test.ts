import { test, expect } from 'bun:test';
import { mergeResults } from './merge.ts';
import type { AnalyzerResult } from './index.ts';

test('mergeResults merges packages and deduplicates by purl', () => {
  const result1: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['file1.txt:10'] },
      { purl: 'pkg:npm/bar@2.0.0', evidence: ['file1.txt:20'] },
    ],
    subprojects: [],
    relationships: [],
  };

  const result2: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['file2.txt:5'] },
      { purl: 'pkg:npm/baz@3.0.0', evidence: [] },
    ],
    subprojects: [],
    relationships: [],
  };

  const merged = mergeResults([result1, result2]);

  expect(merged.packages).toHaveLength(3);
  expect(merged.packages).toEqual([
    { purl: 'pkg:npm/bar@2.0.0', evidence: ['file1.txt:20'] },
    { purl: 'pkg:npm/baz@3.0.0', evidence: [] },
    { purl: 'pkg:npm/foo@1.0.0', evidence: ['file1.txt:10', 'file2.txt:5'] },
  ]);
});

test('mergeResults merges subprojects', () => {
  const result1: AnalyzerResult = {
    packages: [],
    subprojects: [
      {
        purl: 'pkg:npm/project-a@1.0.0',
        definitionFile: '/path/to/a/package.json',
        scopes: [{ scope: 'dependencies', packages: ['pkg:npm/foo@1.0.0'] }],
      },
    ],
    relationships: [],
  };

  const result2: AnalyzerResult = {
    packages: [],
    subprojects: [
      {
        purl: 'pkg:npm/project-b@2.0.0',
        definitionFile: '/path/to/b/package.json',
        scopes: [],
      },
    ],
    relationships: [],
  };

  const merged = mergeResults([result1, result2]);

  expect(merged.subprojects).toHaveLength(2);
  expect(merged.subprojects[0]!.purl).toBe('pkg:npm/project-a@1.0.0');
  expect(merged.subprojects[1]!.purl).toBe('pkg:npm/project-b@2.0.0');
});

test('mergeResults merges relationships and deduplicates', () => {
  const result1: AnalyzerResult = {
    packages: [],
    subprojects: [],
    relationships: [{ from: 'pkg:npm/foo@1.0.0', to: ['pkg:npm/bar@2.0.0', 'pkg:npm/baz@3.0.0'] }],
  };

  const result2: AnalyzerResult = {
    packages: [],
    subprojects: [],
    relationships: [
      { from: 'pkg:npm/foo@1.0.0', to: ['pkg:npm/baz@3.0.0', 'pkg:npm/qux@4.0.0'] },
      { from: 'pkg:npm/bar@2.0.0', to: ['pkg:npm/qux@4.0.0'] },
    ],
  };

  const merged = mergeResults([result1, result2]);

  expect(merged.relationships).toHaveLength(2);
  expect(merged.relationships).toEqual([
    { from: 'pkg:npm/bar@2.0.0', to: ['pkg:npm/qux@4.0.0'] },
    { from: 'pkg:npm/foo@1.0.0', to: ['pkg:npm/bar@2.0.0', 'pkg:npm/baz@3.0.0', 'pkg:npm/qux@4.0.0'] },
  ]);
});

test('mergeResults handles empty array', () => {
  const merged = mergeResults([]);
  expect(merged).toEqual({
    packages: [],
    subprojects: [],
    relationships: [],
  });
});

test('mergeResults sorts output', () => {
  const result: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/zebra@1.0.0', evidence: ['z.txt:1'] },
      { purl: 'pkg:npm/alpha@1.0.0', evidence: ['a.txt:1', 'c.txt:1', 'b.txt:1'] },
    ],
    subprojects: [],
    relationships: [{ from: 'pkg:npm/zebra@1.0.0', to: ['pkg:npm/charlie@1.0.0', 'pkg:npm/alpha@1.0.0'] }],
  };

  const merged = mergeResults([result]);

  // Packages sorted by purl
  expect(merged.packages[0]!.purl).toBe('pkg:npm/alpha@1.0.0');
  expect(merged.packages[1]!.purl).toBe('pkg:npm/zebra@1.0.0');

  // Evidence sorted
  expect(merged.packages[0]!.evidence).toEqual(['a.txt:1', 'b.txt:1', 'c.txt:1']);

  // Relationships sorted by from
  expect(merged.relationships[0]!.from).toBe('pkg:npm/zebra@1.0.0');

  // Relationship 'to' arrays sorted
  expect(merged.relationships[0]!.to).toEqual(['pkg:npm/alpha@1.0.0', 'pkg:npm/charlie@1.0.0']);
});
