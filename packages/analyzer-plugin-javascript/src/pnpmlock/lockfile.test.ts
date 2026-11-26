import { describe, expect, test } from "vite-plus/test";
import {
  parsePackageKey,
  stripPeerDepSuffix,
  getImporters,
  getPackageKeyCandidates,
  buildLineIndex,
  parsePnpmLockfile,
  resolveInside,
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

  test("parses lockfile v6 keys with leading slash", () => {
    expect(parsePackageKey("/lodash@4.17.21")).toEqual({ name: "lodash", version: "4.17.21" });
    expect(parsePackageKey("/@babel/core@7.23.9(@babel/preset-env@7.23.9)")).toEqual({
      name: "@babel/core",
      version: "7.23.9",
    });
  });

  test("parses lockfile v5 keys", () => {
    expect(parsePackageKey("/lodash/4.17.21", "slash")).toEqual({
      name: "lodash",
      version: "4.17.21",
    });
    expect(parsePackageKey("/@sindresorhus/is/4.6.0", "slash")).toEqual({
      name: "@sindresorhus/is",
      version: "4.6.0",
    });
    expect(parsePackageKey("/use-sync-external-store/1.7.0_react@18.3.1", "slash")).toEqual({
      name: "use-sync-external-store",
      version: "1.7.0",
    });
  });

  test("returns null for non-registry keys before lockfile v9", () => {
    const key = "@codeload.github.com/jonschlinkert/is-even/tar.gz/a94a9be";
    expect(parsePackageKey(key, "slash")).toBeNull();
    expect(parsePackageKey(key)).toBeNull();
  });

  test("keeps @ characters inside URL versions", () => {
    expect(parsePackageKey("a@git+ssh://git@github.com/u/a.git#abc123")).toEqual({
      name: "a",
      version: "git+ssh://git@github.com/u/a.git#abc123",
    });
    expect(parsePackageKey("@scope/a@git+ssh://git@github.com/u/a.git#abc123")).toEqual({
      name: "@scope/a",
      version: "git+ssh://git@github.com/u/a.git#abc123",
    });
  });
});

describe("getPackageKeyCandidates", () => {
  test("lockfile v9 and v6 references", () => {
    expect(getPackageKeyCandidates("react-dom", "19.2.0(react@19.2.0)", "at")).toEqual([
      "react-dom@19.2.0(react@19.2.0)",
      "/react-dom@19.2.0(react@19.2.0)",
      "19.2.0(react@19.2.0)",
      "react-dom@19.2.0",
      "/react-dom@19.2.0",
      "19.2.0",
    ]);
  });

  test("aliases reference the package key directly", () => {
    expect(getPackageKeyCandidates("strip-ansi-cjs", "strip-ansi@6.0.1", "at")).toContain(
      "strip-ansi@6.0.1",
    );
    expect(getPackageKeyCandidates("strip-ansi-cjs", "/strip-ansi/6.0.1", "slash")).toContain(
      "/strip-ansi/6.0.1",
    );
  });

  test("lockfile v5 references", () => {
    expect(getPackageKeyCandidates("a", "1.7.0_react@18.3.1", "slash")).toEqual([
      "/a/1.7.0_react@18.3.1",
      "1.7.0_react@18.3.1",
      "/a/1.7.0",
      "1.7.0",
    ]);
  });
});

describe("getImporters", () => {
  test("returns the importers section", () => {
    const importers = { ".": {}, "packages/a": {} };
    expect(getImporters({ lockfileVersion: "9.0", importers })).toBe(importers);
  });

  test("treats top-level dependencies of older lockfiles as root importer", () => {
    const dependencies = { lodash: "4.17.21" };
    expect(getImporters({ lockfileVersion: 5.4, dependencies })).toEqual({
      ".": { dependencies, devDependencies: undefined, optionalDependencies: undefined },
    });
  });

  test("returns nothing for a lockfile without dependencies", () => {
    expect(getImporters({ lockfileVersion: "9.0" })).toEqual({});
  });
});

describe("stripPeerDepSuffix", () => {
  test("strips peer dependency suffix", () => {
    expect(stripPeerDepSuffix("19.2.0(react@19.2.0)")).toBe("19.2.0");
  });

  test("strips lockfile v5 peer dependency suffix", () => {
    expect(stripPeerDepSuffix("1.7.0_react@18.3.1", "slash")).toBe("1.7.0");
  });

  test("returns version without suffix unchanged", () => {
    expect(stripPeerDepSuffix("4.17.21")).toBe("4.17.21");
  });
});

describe("buildLineIndex", () => {
  test("finds quoted package key", () => {
    const content =
      "lockfileVersion: '9.0'\npackages:\n  '@babel/core@7.23.9':\n    resolution: {}";
    expect(buildLineIndex(content).get("@babel/core@7.23.9")).toBe(3);
  });

  test("finds unquoted package key", () => {
    const content = "lockfileVersion: 6.0\npackages:\n  lodash@4.17.21:\n    resolution: {}";
    expect(buildLineIndex(content).get("lodash@4.17.21")).toBe(3);
  });

  test("finds keys containing colons", () => {
    const content = [
      "packages:",
      "  local-dep@file:local:",
      "    resolution: {directory: local, type: directory}",
      "  is-even@https://codeload.github.com/u/is-even/tar.gz/a94a9be:",
      "  ms@2.1.3: {}",
    ].join("\n");
    const index = buildLineIndex(content);
    expect(index.get("local-dep@file:local")).toBe(2);
    expect(index.get("is-even@https://codeload.github.com/u/is-even/tar.gz/a94a9be")).toBe(4);
    expect(index.get("ms@2.1.3")).toBe(5);
  });

  test("keeps the first occurrence of a key", () => {
    const content = "packages:\n  lodash@4.17.21:\nsnapshots:\n  lodash@4.17.21: {}";
    expect(buildLineIndex(content).get("lodash@4.17.21")).toBe(2);
  });

  test("ignores identical keys before the packages section", () => {
    const content = [
      "patchedDependencies:",
      "  is-odd@3.0.1:",
      "    hash: abc",
      "packages:",
      "  is-odd@3.0.1:",
    ].join("\n");
    expect(buildLineIndex(content).get("is-odd@3.0.1")).toBe(5);
  });

  test("skips lines before startLine", () => {
    const content = "packages:\n  lodash@4.17.21:\n---\npackages:\n  lodash@4.17.21:";
    expect(buildLineIndex(content).get("lodash@4.17.21")).toBe(2);
    expect(buildLineIndex(content, 4).get("lodash@4.17.21")).toBe(5);
  });

  test("returns undefined for missing key", () => {
    const content = "lockfileVersion: 9.0\npackages:\n  lodash@4.17.21:\n    resolution: {}";
    expect(buildLineIndex(content).get("react@18.0.0")).toBeUndefined();
  });
});

describe("parsePnpmLockfile", () => {
  const env = [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .:",
    "    configDependencies: {}",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.15.0",
    "        version: 12.15.0",
    "packages:",
    "  pnpm@12.15.0:",
    "    resolution: {}",
  ].join("\n");
  const main = [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .:",
    "    dependencies:",
    "      lodash:",
    "        specifier: ^4.17.21",
    "        version: 4.17.21",
    "packages:",
    "  lodash@4.17.21:",
    "    resolution: {}",
  ].join("\n");

  test("parses a single-document lockfile", () => {
    const { lockfile, startLine } = parsePnpmLockfile(main);
    expect(Object.keys(lockfile.packages ?? {})).toEqual(["lodash@4.17.21"]);
    expect(startLine).toBe(1);
  });

  test("parses a single document with a leading document marker", () => {
    const { lockfile, startLine } = parsePnpmLockfile(`---\n${main}\n`);
    expect(Object.keys(lockfile.packages ?? {})).toEqual(["lodash@4.17.21"]);
    expect(startLine).toBe(2);
  });

  test("skips the env document of a multi-document lockfile", () => {
    const content = `---\n${env}\n\n---\n${main}\n`;
    const { lockfile, startLine } = parsePnpmLockfile(content);
    expect(Object.keys(lockfile.packages ?? {})).toEqual(["lodash@4.17.21"]);
    expect(Object.keys(lockfile.importers?.["."] ?? {})).toEqual(["dependencies"]);
    expect(content.split("\n")[startLine - 1]).toBe("lockfileVersion: '9.0'");
    expect(startLine).toBe(15);
  });

  test("keeps a document that has regular dependencies next to env keys", () => {
    const content = main.replace(
      "    dependencies:",
      "    configDependencies: {}\n    dependencies:",
    );
    const { lockfile } = parsePnpmLockfile(content);
    expect(Object.keys(lockfile.packages ?? {})).toEqual(["lodash@4.17.21"]);
  });

  test("tolerates empty importers", () => {
    const { lockfile } = parsePnpmLockfile("lockfileVersion: '9.0'\nimporters:\n  .:\n");
    expect(lockfile.importers).toEqual({ ".": null });
  });

  test("returns no packages when the file only contains an env document", () => {
    const { lockfile } = parsePnpmLockfile(`---\n${env}\n`);
    expect(lockfile.lockfileVersion).toBe("9.0");
    expect(lockfile.packages).toBeUndefined();
    expect(lockfile.importers).toEqual({ ".": {} });
  });

  test("throws on invalid YAML", () => {
    expect(() => parsePnpmLockfile("lockfileVersion: '9.0'\npackages: [")).toThrow();
  });

  test("throws on an empty file", () => {
    expect(() => parsePnpmLockfile("")).toThrow("does not contain a lockfile document");
  });
});

describe("resolveInside", () => {
  test("resolves paths inside of the directory", () => {
    expect(resolveInside("/repo", ".")).toBe("/repo");
    expect(resolveInside("/repo", "packages/a")).toBe("/repo/packages/a");
    expect(resolveInside("/repo", "./local")).toBe("/repo/local");
    expect(resolveInside("/repo", "packages/../local")).toBe("/repo/local");
    expect(resolveInside("/repo", "..local")).toBe("/repo/..local");
  });

  test("rejects paths climbing above the directory", () => {
    expect(resolveInside("/repo", "..")).toBeNull();
    expect(resolveInside("/repo", "../sibling")).toBeNull();
    expect(resolveInside("/repo", "packages/../../sibling")).toBeNull();
    expect(resolveInside("/repo", "..\\sibling")).toBeNull();
  });

  test("rejects absolute paths", () => {
    expect(resolveInside("/repo", "/etc")).toBeNull();
    expect(resolveInside("/repo", "C:\\Users")).toBeNull();
    expect(resolveInside("/repo", "C:/Users")).toBeNull();
  });
});
