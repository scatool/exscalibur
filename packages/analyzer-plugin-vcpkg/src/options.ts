import { z } from "zod";

export const targetPlatformSchema = z.strictObject({
  targetArchitecture: z.enum(["x86", "x64", "arm", "arm64", "arm64ec", "wasm32", "mips64"]),
  cmakeSystemName: z.enum([
    "",
    "WindowsStore",
    "MinGW",
    "Linux",
    "Darwin",
    "iOS",
    "FreeBSD",
    "OpenBSD",
    "Android",
    "Emscripten",
    "QNX",
    "VxWorks",
  ]),
  xboxConsoleTarget: z.string().optional(),
  libraryLinkage: z.enum(["dynamic", "static"]).optional(),
  crtLinkage: z.enum(["dynamic", "static"]).optional(),
  /**
   * little hack, set to true for for TARGET_TRIPLET == HOST_TRIPLET
   * @default true
   */
  isNative: z.boolean().default(true),
});

/**
 * Options for the vcpkg extractor.
 */
export const optionsSchema = z.strictObject({
  /**
   * Array of glob patterns to ignore when scanning for lockfiles/package files.
   * Files matching any of these patterns will be excluded from extraction.
   * @default ['**\/build\/**']
   */
  ignore: z.array(z.string()).default(["**/build/**"]),

  /**
   * Path to the vcpkg binary.
   * @default 'vcpkg'
   */
  vcpkgPath: z.string().default("vcpkg"),

  /**
   * Optional target platform recorded as graph context for environment queries.
   * Native platform alternatives remain present; this does not establish selection.
   */
  targetPlatform: targetPlatformSchema.optional(),

  /**
   * Requested feature policy, retained in graph context. All native feature declarations
   * remain present; enabled feature sets require a native resolver observation.
   * @default false
   */
  includeAllFeatures: z.boolean().default(false),
});

export type VcpkgOptions = z.infer<typeof optionsSchema>;
export type VcpkgTargetPlatform = z.infer<typeof targetPlatformSchema>;
