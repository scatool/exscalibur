import { describe, expect, test } from "vite-plus/test";
import { createNpmPurl } from "./npm-utils.ts";

describe("createNpmPurl", () => {
  test("creates PURL for unscoped package", () => {
    expect(createNpmPurl("react", "18.0.0")).toBe("pkg:npm/react@18.0.0");
  });

  test("creates PURL for scoped package", () => {
    expect(createNpmPurl("@babel/core", "7.0.0")).toBe("pkg:npm/%40babel/core@7.0.0");
  });

  test("creates PURL for scoped package with complex name", () => {
    expect(createNpmPurl("@types/node", "20.11.0")).toBe("pkg:npm/%40types/node@20.11.0");
  });

  test("handles prerelease version", () => {
    expect(createNpmPurl("react", "19.0.0-rc.1")).toBe("pkg:npm/react@19.0.0-rc.1");
  });

  test("handles package name without @ prefix as unscoped", () => {
    expect(createNpmPurl("lodash", "4.17.21")).toBe("pkg:npm/lodash@4.17.21");
  });
});
