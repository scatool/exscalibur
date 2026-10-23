import { describe, expect, test } from "vite-plus/test";
import {
  findLineNumber,
  isWorkspacePackage,
  parseCargoLockfile,
  parseCargoToml,
  parseDependency,
} from "./lockfile.ts";

describe("parseCargoLockfile", () => {
  test("parses basic Cargo.lock file", () => {
    const content = `
version = 3

[[package]]
name = "serde"
version = "1.0.193"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "25dd9975e68d0cb5aa1120c288333fc98731bd1dd12f561e468ea4728c042b89"
dependencies = [
 "serde_derive",
]

[[package]]
name = "my-app"
version = "0.1.0"
dependencies = [
 "serde",
]
    `;

    const result = parseCargoLockfile(content);
    expect(result.version).toBe(3);
    expect(result.package).toHaveLength(2);
    expect(result.package[0]?.name).toBe("serde");
    expect(result.package[0]?.version).toBe("1.0.193");
    expect(result.package[0]?.dependencies).toEqual(["serde_derive"]);
  });

  test("parses lockfile with no dependencies", () => {
    const content = `
version = 3

[[package]]
name = "simple"
version = "1.0.0"
    `;

    const result = parseCargoLockfile(content);
    expect(result.package).toHaveLength(1);
    expect(result.package[0]?.dependencies).toBeUndefined();
  });
});

describe("parseCargoToml", () => {
  test("parses basic Cargo.toml file", () => {
    const content = `
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = "1.0"
    `;

    const result = parseCargoToml(content);
    expect(result.package?.name).toBe("my-app");
    expect(result.package?.version).toBe("0.1.0");
  });

  test("parses workspace Cargo.toml", () => {
    const content = `
[workspace]
members = ["app", "lib"]
resolver = "2"
    `;

    const result = parseCargoToml(content);
    expect(result.workspace?.members).toEqual(["app", "lib"]);
  });
});

describe("parseDependency", () => {
  test("parses dependency with version", () => {
    const result = parseDependency("serde 1.0.193");
    expect(result).toEqual({ name: "serde", version: "1.0.193" });
  });

  test("parses dependency without version", () => {
    const result = parseDependency("tokio");
    expect(result).toEqual({ name: "tokio" });
  });

  test("parses dependency with source disambiguation", () => {
    const result = parseDependency(
      "mylib 0.1.0 (registry+https://github.com/rust-lang/crates.io-index)",
    );
    expect(result).toEqual({
      name: "mylib",
      version: "0.1.0",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    });
  });

  test("parses dependency with git source", () => {
    const result = parseDependency("foo 1.0.0 (git+https://github.com/example/foo#abc123)");
    expect(result).toEqual({
      name: "foo",
      version: "1.0.0",
      source: "git+https://github.com/example/foo#abc123",
    });
  });

  test("handles malformed dependency string", () => {
    const result = parseDependency("foo bar baz");
    expect(result).toEqual({ name: "foo bar baz" });
  });
});

describe("findLineNumber", () => {
  test("finds package by name", () => {
    const content = `
version = 3

[[package]]
name = "serde"
version = "1.0.193"

[[package]]
name = "tokio"
version = "1.35.0"
    `;

    expect(findLineNumber(content, "serde")).toBe(5);
    expect(findLineNumber(content, "tokio")).toBe(9);
  });

  test("returns undefined for non-existent package", () => {
    const content = `
[[package]]
name = "serde"
version = "1.0.193"
    `;

    expect(findLineNumber(content, "nonexistent")).toBeUndefined();
  });

  test("handles indentation", () => {
    const content = `
[[package]]
  name = "indented"
  version = "1.0.0"
    `;

    expect(findLineNumber(content, "indented")).toBe(3);
  });
});

describe("isWorkspacePackage", () => {
  test("identifies workspace package (no source)", () => {
    const pkg = {
      name: "my-workspace-crate",
      version: "0.1.0",
    };

    expect(isWorkspacePackage(pkg)).toBe(true);
  });

  test("identifies external package (with source)", () => {
    const pkg = {
      name: "serde",
      version: "1.0.193",
      source: "registry+https://github.com/rust-lang/crates.io-index",
    };

    expect(isWorkspacePackage(pkg)).toBe(false);
  });

  test("identifies git package (with source)", () => {
    const pkg = {
      name: "my-git-dep",
      version: "0.1.0",
      source: "git+https://github.com/example/my-git-dep?tag=v0.1.0#abc123",
    };

    expect(isWorkspacePackage(pkg)).toBe(false);
  });
});
