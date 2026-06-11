import { describe, expect, test } from "vitest";
import type { Node } from "./types.ts";
import { createConanPurl, createLocalNodeConanPurl, normalizeConanName } from "./utils.ts";

describe("createConanPurl", () => {
  test("creates PURL with rrev qualifier", () => {
    expect(createConanPurl("fmt", "10.1.1", "021e170cf81db57da82b5f737b6906c1")).toBe(
      "pkg:conan/fmt@10.1.1?rrev=021e170cf81db57da82b5f737b6906c1",
    );
  });

  test("normalizes package name to lowercase", () => {
    expect(createConanPurl("OpenSSL", "3.0.0", "abc123")).toBe(
      "pkg:conan/openssl@3.0.0?rrev=abc123",
    );
    expect(createConanPurl("ZLIB", "1.2.11", "def456")).toBe("pkg:conan/zlib@1.2.11?rrev=def456");
  });

  test("omits rrev qualifier when empty/not set", () => {
    expect(createConanPurl("boost", "1.78.0", "")).toBe("pkg:conan/boost@1.78.0");
    expect(createConanPurl("boost", "1.78.0")).toBe("pkg:conan/boost@1.78.0");
  });
});

describe("createLocalNodeConanPurl", () => {
  test("uses node name, version, and rrev when available", () => {
    const node = {
      name: "MyLocalPkg",
      version: "2.4.0",
      rrev: "local-rrev",
    } as Node;

    expect(createLocalNodeConanPurl(node, "/repo/project/conanfile.py")).toBe(
      "pkg:conan/mylocalpkg@2.4.0?local=true&rrev=local-rrev",
    );
  });

  test("falls back to parent directory name and default version for unnamed local nodes", () => {
    const node = {
      name: null,
      version: null,
      rrev: null,
    } as Node;

    expect(createLocalNodeConanPurl(node, "/repo/my-app/conanfile.txt")).toBe(
      "pkg:conan/my-app@0.0.0?local=true",
    );
  });

  test("throws error when unable to determine package name", () => {
    const node = {
      name: null,
      version: null,
      rrev: null,
    } as Node;

    expect(() => createLocalNodeConanPurl(node, "/conanfile.py")).toThrow(
      'Unable to create PURL for local node: {"name":null,"version":null,"rrev":null}',
    );
  });
});

describe("normalizeConanName", () => {
  test("converts to lowercase", () => {
    expect(normalizeConanName("OpenSSL")).toBe("openssl");
    expect(normalizeConanName("ZLIB")).toBe("zlib");
  });

  test("preserves lowercase names", () => {
    expect(normalizeConanName("openssl")).toBe("openssl");
  });

  test("preserves hyphens and numbers", () => {
    expect(normalizeConanName("CLI11")).toBe("cli11");
    expect(normalizeConanName("some-lib")).toBe("some-lib");
  });
});
