# @scatool/analyzer-plugin-cpp

**Note**: This plugin is experimental.

C++ ecosystem analyzer plugin for Exscalibur.

The following package managers are supported:

- Conan: <https://conan.io/>
- Vcpkg: <https://learn.microsoft.com/en-us/vcpkg/>

## Package Manager Support

### Conan

Supported package files: `conanfile.txt`, `conanfile.py` and `conan.lock`.

Supported extractor options:

- `ignore` - glob patterns to ignore files (default: `['**/build/**']`)
- `conanPath` - path to the conan binary (default: `conan`)
- `profileBuild` - optional value passed as `--profile:build` to `conan graph info`
- `profileHost` - optional value passed as `--profile:host` to `conan graph info`

Known limitations:

- Only Conan 2.x is supported.
- Conan Workspaces are not supported (as they are in preview by the time of writing).
- Remote types other than "conan-center" were not tested and might not work.
- Can only extract dependencies for a single platform and not all dependencies for all platforms.

### Vcpkg

Supported extractor options:

- `ignore` - glob patterns to ignore files (default: `['**/build/**']`)
- `vcpkgPath` - path to the vcpkg binary (default: `vcpkg`)
- `targetPlatform` - optional target platform to filter dependencies (see [vcpkg documentation](https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json#platform-expression)). When specified, only dependencies matching the platform will be included. If not specified, all platforms will be included. Supports:
  - `targetArchitecture` - one of: `x86`, `x64`, `arm`, `arm64`, `arm64ec`, `wasm32`, `mips64`
  - `cmakeSystemName` - one of: `WindowsStore`, `MinGW`, `Linux`, `Darwin`, `iOS`, `FreeBSD`, `OpenBSD`, `Android`, `Emscripten`, `QNX`, `VxWorks`, or empty string
  - `xboxConsoleTarget` - optional string for Xbox console target
  - `libraryLinkage` - optional: `dynamic` or `static`
  - `crtLinkage` - optional: `dynamic` or `static`
  - `isNative` - whether target triplet equals host triplet (default: `true`)
- `includeAllFeatures` - include all features and their dependencies (default: `false`; if false, only default features are included)

Known limitations:

- Default features in the primary `vcpkg.json` files are not supported. Either all features or all default features are included, when extracting dependencies.
- Baselines before `68a74950d0400f5a803026d0860f49853984bf11` (Jan 21, 2021) are not supported (see [src/vcpkg/README.md](./src/vcpkg/README.md) for details).
- Any `vcpkg.json` is not validated (e.g. checked if `version>=` of dependencies are satisfied). Please ensure that the `vcpkg.json` files are valid and consistent with the lockfiles before extraction.

For further implementation considerations, see [src/vcpkg/README.md](./src/vcpkg/README.md).

## Setup Environment

To use the vcpkg extractor you need to install vcpkg.
Either install [vcpkg manually](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started?pivots=shell-bash) or using the corresponding mise plugin:

```bash
cd exscalibur
mise plugin install vcpkg https://github.com/markus-gerber/mise-vcpkg
mise use vcpkg
```

Additionally, to run the verification tests (`vcpkg install --dry-run should match dependencies extracted for [...]`) you need to have the corresponding C++ toolchain installed:

### Linux

You can use any C++ compiler, e.g. clang using mise:

```bash
cd exscalibur
mise use clang
```

### Windows

On Windows, you need to have Visual Studio with the C++ toolchain installed.

### MacOS

\[_Not tested yet, but probably similar to linux_\]
