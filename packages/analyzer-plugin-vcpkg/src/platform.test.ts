import { describe, expect, test } from "vite-plus/test";
import type { VcpkgTargetPlatform } from "./options.ts";
import { matchesPlatform } from "./platform.ts";

function target(overrides: Partial<VcpkgTargetPlatform>): VcpkgTargetPlatform {
  return {
    targetArchitecture: "x64",
    cmakeSystemName: "",
    isNative: true,
    ...overrides,
  };
}

const targets = {
  windowsStatic: target({
    targetArchitecture: "x64",
    cmakeSystemName: "",
    xboxConsoleTarget: "Scarlett",
    libraryLinkage: "static",
    crtLinkage: "static",
  }),
  windowsDynamic: target({
    targetArchitecture: "x86",
    cmakeSystemName: "",
    libraryLinkage: "dynamic",
    crtLinkage: "dynamic",
    isNative: false,
  }),
  linuxDynamic: target({
    targetArchitecture: "x64",
    cmakeSystemName: "Linux",
    libraryLinkage: "dynamic",
    crtLinkage: "static",
  }),
  linuxStatic: target({
    targetArchitecture: "x64",
    cmakeSystemName: "Linux",
    libraryLinkage: "static",
    crtLinkage: "static",
  }),
  androidArm: target({
    targetArchitecture: "arm",
    cmakeSystemName: "Android",
    isNative: false,
  }),
  osxArm64: target({
    targetArchitecture: "arm64",
    cmakeSystemName: "Darwin",
  }),
  emscriptenWasm: target({
    targetArchitecture: "wasm32",
    cmakeSystemName: "Emscripten",
  }),
  mingwX86: target({
    targetArchitecture: "x86",
    cmakeSystemName: "MinGW",
  }),
  uwpX64: target({
    targetArchitecture: "x64",
    cmakeSystemName: "WindowsStore",
    isNative: false,
  }),
  freebsdX64: target({
    targetArchitecture: "x64",
    cmakeSystemName: "FreeBSD",
  }),
};

describe("matchesPlatform", () => {
  test("matches simple identifiers across targets", () => {
    expect(matchesPlatform("windows", targets.windowsStatic)).toBe(true);
    expect(matchesPlatform("linux", targets.linuxDynamic)).toBe(true);
    expect(matchesPlatform("android", targets.androidArm)).toBe(true);
    expect(matchesPlatform("osx", targets.osxArm64)).toBe(true);
    expect(matchesPlatform("emscripten", targets.emscriptenWasm)).toBe(true);
  });

  test("supports architecture identifiers and aliases", () => {
    expect(matchesPlatform("x64", targets.linuxDynamic)).toBe(true);
    expect(matchesPlatform("x86", targets.mingwX86)).toBe(true);
    expect(matchesPlatform("arm", targets.androidArm)).toBe(true);
    expect(matchesPlatform("arm32", targets.androidArm)).toBe(true);
    expect(matchesPlatform("arm64", targets.osxArm64)).toBe(true);
    expect(matchesPlatform("wasm32", targets.emscriptenWasm)).toBe(true);
  });

  test("supports negation and keyword operators", () => {
    expect(matchesPlatform("!windows", targets.linuxDynamic)).toBe(true);
    expect(matchesPlatform("not linux", targets.windowsDynamic)).toBe(true);
    expect(matchesPlatform("windows and x86", targets.windowsDynamic)).toBe(true);
    expect(matchesPlatform("linux and x86", targets.windowsDynamic)).toBe(false);
  });

  test("handles or and comma as or", () => {
    expect(matchesPlatform("linux | windows", targets.windowsStatic)).toBe(true);
    expect(matchesPlatform("linux,windows", targets.linuxDynamic)).toBe(true);
    expect(matchesPlatform("ios,android", targets.androidArm)).toBe(true);
  });

  test("respects precedence and parentheses", () => {
    expect(matchesPlatform("windows & x64 | linux", targets.linuxDynamic)).toBe(true);
    expect(matchesPlatform("(linux | osx) & arm64", targets.osxArm64)).toBe(true);
    expect(matchesPlatform("(linux | osx) & arm64", targets.linuxDynamic)).toBe(false);
    expect(matchesPlatform("((linux | osx) & arm64)", targets.linuxDynamic)).toBe(false);
    expect(matchesPlatform("(linux | osx) & (arm64)", targets.linuxDynamic)).toBe(false);
    expect(matchesPlatform("(linux | osx) & (windows, native)", targets.linuxDynamic)).toBe(true);
  });

  test("matches system-name derived identifiers", () => {
    expect(matchesPlatform("mingw", targets.mingwX86)).toBe(true);
    expect(matchesPlatform("uwp", targets.uwpX64)).toBe(true);
    expect(matchesPlatform("xbox", targets.windowsStatic)).toBe(true);
    expect(matchesPlatform("freebsd", targets.freebsdX64)).toBe(true);
  });

  test("matches linkage and native identifiers", () => {
    expect(matchesPlatform("static", targets.linuxStatic)).toBe(true);
    expect(matchesPlatform("staticcrt", targets.linuxStatic)).toBe(true);
    expect(matchesPlatform("static", targets.linuxDynamic)).toBe(false);
    expect(matchesPlatform("native", targets.windowsDynamic)).toBe(false);
  });

  test("returns false for unknown identifiers", () => {
    expect(matchesPlatform("unknown", targets.windowsStatic)).toBe(false);
  });

  test('returns false for invalid "or" keyword', () => {
    // vcpkg reference: "the or keyword is reserved but not valid in platform expressions"
    expect(matchesPlatform("windows or linux", targets.windowsStatic)).toBe(false);
  });
});
