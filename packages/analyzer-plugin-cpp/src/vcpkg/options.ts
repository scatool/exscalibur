import { z } from 'zod';

export const targetPlatformSchema = z.strictObject({
  targetArchitecture: z.enum(['x86', 'x64', 'arm', 'arm64', 'arm64ec', 'wasm32', 'mips64']),
  cmakeSystemName: z.enum([
    '',
    'WindowsStore',
    'MinGW',
    'Linux',
    'Darwin',
    'iOS',
    'FreeBSD',
    'OpenBSD',
    'Android',
    'Emscripten',
    'QNX',
    'VxWorks',
  ]),
  xboxConsoleTarget: z.string().optional(),
  libraryLinkage: z.enum(['dynamic', 'static']).optional(),
  crtLinkage: z.enum(['dynamic', 'static']).optional(),
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
  ignore: z.array(z.string()).default(['**/build/**']),

  /**
   * Path to the vcpkg binary.
   * @default 'vcpkg'
   */
  vcpkgPath: z.string().default('vcpkg'),

  /**
   * Optional Target platform to filter dependencies for as specified in
   * <https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json#platform-expression>
   *
   * If specified, only dependencies with a matching platform will be included in the results.
   * If not specified, dependencies for all platforms will be included.
   */
  targetPlatform: targetPlatformSchema.optional(),

  /**
   * Whether to include all features and their corresponding dependencies of each port in the results.
   * If false, only the default features of each port will be included.
   * @default false
   */
  includeAllFeatures: z.boolean().default(false),
});

export type VcpkgOptions = z.infer<typeof optionsSchema>;
export type VcpkgTargetPlatform = z.infer<typeof targetPlatformSchema>;
