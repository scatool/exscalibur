import { describe, expect, test } from "vite-plus/test";
import { createGoPurl } from "./go-utils.ts";

describe("createGoPurl", () => {
  test("creates PURL with version", () => {
    expect(createGoPurl("github.com/pkg/errors", "v0.9.1")).toBe(
      "pkg:golang/github.com%2Fpkg%2Ferrors@v0.9.1",
    );
  });

  test("creates PURL without version", () => {
    expect(createGoPurl("github.com/pkg/errors")).toBe("pkg:golang/github.com%2Fpkg%2Ferrors");
  });

  test("handles module with deep path", () => {
    expect(createGoPurl("golang.org/x/text", "v0.14.0")).toBe(
      "pkg:golang/golang.org%2Fx%2Ftext@v0.14.0",
    );
  });
});
