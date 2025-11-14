import { test, expect } from 'bun:test';
import { validateResult } from './validate.ts';
import type { AnalyzerResult } from '@scatool/analyzer-core';

test('validateResult passes for valid result', () => {
  const validResult: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] },
      { purl: 'pkg:npm/bar@2.0.0', evidence: ['package.json#2'] },
    ],
    subprojects: [
      {
        purl: 'pkg:npm/myapp@1.0.0',
        definitionFile: 'package.json',
        scopes: [
          {
            scope: 'dependencies',
            packages: ['pkg:npm/foo@1.0.0', 'pkg:npm/bar@2.0.0'],
          },
        ],
      },
    ],
    relationships: [{ from: 'pkg:npm/foo@1.0.0', to: ['pkg:npm/bar@2.0.0'] }],
    issues: [],
  };

  expect(() => validateResult(validResult)).not.toThrow();
});

test('validateResult throws when subproject purl is in packages', () => {
  const invalidResult: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/myapp@1.0.0', evidence: ['package.json#1'] }, // subproject purl!
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#2'] },
    ],
    subprojects: [
      {
        purl: 'pkg:npm/myapp@1.0.0',
        definitionFile: 'package.json',
        scopes: [
          {
            scope: 'dependencies',
            packages: ['pkg:npm/foo@1.0.0'],
          },
        ],
      },
    ],
    relationships: [],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow('Subproject purls found in packages array: pkg:npm/myapp@1.0.0');
});

test('validateResult throws when subproject purl is in relationships (from)', () => {
  const invalidResult: AnalyzerResult = {
    packages: [{ purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] }],
    subprojects: [
      {
        purl: 'pkg:npm/myapp@1.0.0',
        definitionFile: 'package.json',
        scopes: [
          {
            scope: 'dependencies',
            packages: ['pkg:npm/foo@1.0.0'],
          },
        ],
      },
    ],
    relationships: [
      { from: 'pkg:npm/myapp@1.0.0', to: ['pkg:npm/foo@1.0.0'] }, // subproject in 'from'!
    ],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow('Subproject purls found in relationships: pkg:npm/myapp@1.0.0');
});

test('validateResult throws when subproject purl is in relationships (to)', () => {
  const invalidResult: AnalyzerResult = {
    packages: [{ purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] }],
    subprojects: [
      {
        purl: 'pkg:npm/myapp@1.0.0',
        definitionFile: 'package.json',
        scopes: [
          {
            scope: 'dependencies',
            packages: ['pkg:npm/foo@1.0.0'],
          },
        ],
      },
    ],
    relationships: [
      { from: 'pkg:npm/foo@1.0.0', to: ['pkg:npm/myapp@1.0.0'] }, // subproject in 'to'!
    ],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow('Subproject purls found in relationships: pkg:npm/myapp@1.0.0');
});

test('validateResult throws when package purls are duplicated', () => {
  const invalidResult: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] },
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#2'] }, // duplicate!
      { purl: 'pkg:npm/bar@2.0.0', evidence: ['package.json#3'] },
    ],
    subprojects: [],
    relationships: [],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow('Duplicate package purls found: pkg:npm/foo@1.0.0');
});

test('validateResult throws when subproject purls are duplicated', () => {
  const invalidResult: AnalyzerResult = {
    packages: [{ purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] }],
    subprojects: [
      {
        purl: 'pkg:npm/myapp@1.0.0',
        definitionFile: 'package.json',
        scopes: [],
      },
      {
        purl: 'pkg:npm/myapp@1.0.0', // duplicate!
        definitionFile: 'apps/frontend/package.json',
        scopes: [],
      },
    ],
    relationships: [],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow('Duplicate subproject purls found: pkg:npm/myapp@1.0.0');
});

test('validateResult throws when relationship "to" array contains duplicates', () => {
  const invalidResult: AnalyzerResult = {
    packages: [
      { purl: 'pkg:npm/foo@1.0.0', evidence: ['package.json#1'] },
      { purl: 'pkg:npm/bar@2.0.0', evidence: ['package.json#2'] },
    ],
    subprojects: [],
    relationships: [
      {
        from: 'pkg:npm/foo@1.0.0',
        to: ['pkg:npm/bar@2.0.0', 'pkg:npm/bar@2.0.0'], // duplicate in 'to'!
      },
    ],
    issues: [],
  };

  expect(() => validateResult(invalidResult)).toThrow(
    "Duplicate purls in relationship 'to' array for 'pkg:npm/foo@1.0.0': pkg:npm/bar@2.0.0",
  );
});
