# @scatool/analyzer-plugin-conan

**Note**: This plugin is experimental.

Conan analyzer plugin for Exscalibur. The default extractor returns format 2; see
[result semantics](./RESULT.md) for native contexts and scope roots.

Supported package files: `conanfile.txt`, `conanfile.py` and `conan.lock`.

Supported extractor options:

- `ignore` - glob patterns to ignore files (default: `['**/build/**']`)
- `conanPath` - path to the conan binary (default: `conan`)
- `profileBuild` - optional value passed as `--profile:build` to `conan graph info`
- `profileHost` - optional value passed as `--profile:host` to `conan graph info`
- `conanArgs` - additional arguments passed to `conan graph info`
- `conanFiles` - glob patterns to identify conanfiles (default: `['**/conanfile.{txt,py}']`)

Known limitations:

- Only Conan 2.x is supported.
- Conan Workspaces are not supported.
- Remote types other than `conan-center` were not tested and might not work.
- Dependencies can only be extracted for a single platform, not all platforms at once.
