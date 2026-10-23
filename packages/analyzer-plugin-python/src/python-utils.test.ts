import { describe, expect, test } from "vite-plus/test";
import { createPypiPurl, normalizePythonName, findTomlPackageLineNumber } from "./python-utils.ts";

describe("createPypiPurl", () => {
  test("creates PURL for simple package", () => {
    expect(createPypiPurl("requests", "2.31.0")).toBe("pkg:pypi/requests@2.31.0");
  });

  test("creates versionless PURL when no resolved version is available", () => {
    expect(createPypiPurl("requests")).toBe("pkg:pypi/requests");
  });

  test("normalizes underscores to hyphens", () => {
    expect(createPypiPurl("my_package", "1.0.0")).toBe("pkg:pypi/my-package@1.0.0");
  });

  test("normalizes to lowercase", () => {
    expect(createPypiPurl("Flask", "3.0.0")).toBe("pkg:pypi/flask@3.0.0");
  });

  test("normalizes mixed case and underscores", () => {
    expect(createPypiPurl("My_Package", "1.0.0")).toBe("pkg:pypi/my-package@1.0.0");
  });
});

describe("normalizePythonName", () => {
  test("lowercases name", () => {
    expect(normalizePythonName("Flask")).toBe("flask");
  });

  test("replaces underscores with hyphens", () => {
    expect(normalizePythonName("my_package")).toBe("my-package");
  });

  test("handles already normalized name", () => {
    expect(normalizePythonName("requests")).toBe("requests");
  });
});

describe("findTomlPackageLineNumber", () => {
  test("finds package by name", () => {
    const lines = ["[[package]]", 'name = "requests"', 'version = "2.31.0"'];
    expect(findTomlPackageLineNumber(lines, "requests")).toBe(2);
  });

  test("finds package with underscore normalization", () => {
    const lines = ["[[package]]", 'name = "my-package"', 'version = "1.0.0"'];
    expect(findTomlPackageLineNumber(lines, "my_package")).toBe(2);
  });

  test("returns undefined for missing package", () => {
    const lines = ["[[package]]", 'name = "requests"', 'version = "2.31.0"'];
    expect(findTomlPackageLineNumber(lines, "flask")).toBeUndefined();
  });
});
