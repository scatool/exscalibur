# @scatool/analyzer-plugin-cpp

**Note**: This plugin is experimental.

C++ ecosystem analyzer plugin for Excalibur.

The following package managers are supported:

- Conan: <https://conan.io/>

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
