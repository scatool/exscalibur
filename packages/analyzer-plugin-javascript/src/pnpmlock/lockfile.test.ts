import { describe, expect, test } from "vite-plus/test";
import {
  parsePackageKey,
  stripPeerDepSuffix,
  isGitPackageKey,
  findLineNumber,
} from "./lockfile.ts";

describe("parsePackageKey", () => {
  test("parses simple package key", () => {
    expect(parsePackageKey("lodash@4.17.21")).toEqual({ name: "lodash", version: "4.17.21" });
  });

  test("parses scoped package key", () => {
    expect(parsePackageKey("@babel/core@7.23.9")).toEqual({
      name: "@babel/core",
      version: "7.23.9",
    });
  });

  test("strips peer dependency suffix", () => {
    expect(parsePackageKey("@babel/core@7.23.9(@babel/preset-env@7.23.9)")).toEqual({
      name: "@babel/core",
      version: "7.23.9",
    });
  });

  test("returns null for invalid key", () => {
    expect(parsePackageKey("invalid")).toBeNull();
  });
});

describe("stripPeerDepSuffix", () => {
  test("strips peer dependency suffix", () => {
    expect(stripPeerDepSuffix("19.2.0(react@19.2.0)")).toBe("19.2.0");
  });

  test("returns version without suffix unchanged", () => {
    expect(stripPeerDepSuffix("4.17.21")).toBe("4.17.21");
  });
});

describe("isGitPackageKey", () => {
  test("detects git+ URL", () => {
    expect(isGitPackageKey("pkg@git+https://github.com/user/repo")).toBe(true);
  });

  test("detects github: shorthand", () => {
    expect(isGitPackageKey("pkg@github:user/repo#commit")).toBe(true);
  });

  test("detects https tarball", () => {
    expect(isGitPackageKey("pkg@https://example.com/pkg.tgz")).toBe(true);
  });

  test("returns false for regular version", () => {
    expect(isGitPackageKey("lodash@4.17.21")).toBe(false);
  });
});

describe("findLineNumber", () => {
  test("finds quoted package key", () => {
    const content =
      "lockfileVersion: '9.0'\npackages:\n  '@babel/core@7.23.9':\n    resolution: {}";
    expect(findLineNumber(content, "@babel/core@7.23.9")).toBe(3);
  });

  test("finds unquoted package key", () => {
    const content = "lockfileVersion: 6.0\npackages:\n  lodash@4.17.21:\n    resolution: {}";
    expect(findLineNumber(content, "lodash@4.17.21")).toBe(3);
  });

  test("returns undefined for missing key", () => {
    const content = "lockfileVersion: 9.0\npackages:\n  lodash@4.17.21:\n    resolution: {}";
    expect(findLineNumber(content, "react@18.0.0")).toBeUndefined();
  });
});
