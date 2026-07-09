# @scatool/analyzer-plugin-vcpkg

**Note**: This plugin is experimental.

vcpkg analyzer plugin for Exscalibur.

Supported package files: `vcpkg.json`.

Supported extractor options:

- `ignore` - glob patterns to ignore files (default: `['**/build/**']`)
- `vcpkgPath` - path to the vcpkg binary (default: `vcpkg`)
- `targetPlatform` - optional target platform to filter dependencies (see [vcpkg documentation](https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json#platform-expression)). When specified, only dependencies matching the platform will be included. If not specified, all platforms will be included.
- `includeAllFeatures` - include all features and their dependencies (default: `false`; if false, only default features are included)

Known limitations:

- Default features in the primary `vcpkg.json` files are not supported. Either all features or all default features are included when extracting dependencies.
- Baselines before `68a74950d0400f5a803026d0860f49853984bf11` (Jan 21, 2021) are not supported. See [src/README.md](./src/README.md) for details.
- `vcpkg.json` files are not validated, including whether `version>=` constraints are satisfied.

## Setup Environment

To use the vcpkg extractor you need to install vcpkg. Either install [vcpkg manually](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started?pivots=shell-bash) or using the corresponding mise plugin:

```bash
cd exscalibur
mise plugin install vcpkg https://github.com/markus-gerber/mise-vcpkg
mise use vcpkg
```

To run the verification tests (`vcpkg install --dry-run should match dependencies extracted for [...]`) you also need the corresponding C++ toolchain installed.
