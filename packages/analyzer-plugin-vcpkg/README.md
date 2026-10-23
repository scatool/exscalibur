# @scatool/analyzer-plugin-vcpkg

**Note**: This plugin is experimental.

vcpkg analyzer plugin for Exscalibur.

Supported package files: `vcpkg.json`.

The default extractor returns format 2. See [result semantics](./RESULT_V2.md) for
registry-candidate bindings and conservative host/target/feature handling.

Supported extractor options:

- `ignore` - glob patterns to ignore files (default: `['**/build/**']`)
- `vcpkgPath` - path to the vcpkg binary (default: `vcpkg`)
- `targetPlatform` - optional target platform recorded in graph context for environment queries. Native platform alternatives remain in the graph.
- `includeAllFeatures` - records the requested feature policy in graph context (default: `false`). All source feature declarations remain available; this is not a resolver-selected enabled-feature set.

Known limitations:

- Native feature activation and effective version resolution are not established by registry metadata. Default features, overrides and baseline are preserved on the manifest view.
- Baselines before `68a74950d0400f5a803026d0860f49853984bf11` (Jan 21, 2021) are not supported. See [src/README.md](./src/README.md) for details.
- `vcpkg.json` files are not validated, including whether `version>=` constraints are satisfied.

## Setup Environment

To use the vcpkg extractor you need to install vcpkg. Either install [vcpkg manually](https://learn.microsoft.com/en-us/vcpkg/get_started/get-started?pivots=shell-bash) or using the corresponding mise plugin:

```bash
cd exscalibur
mise plugin install vcpkg https://github.com/markus-gerber/mise-vcpkg
mise use vcpkg
```

To run the verification tests (`native selected dependencies are represented by registry candidates: [...]`) you also need the corresponding C++ toolchain installed.
