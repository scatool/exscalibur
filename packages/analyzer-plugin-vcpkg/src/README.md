# VCPKG

Vcpkg is a C++ package manager developed by Microsoft. It provides a convenient way to manage C++ libraries and their dependencies across different platforms.

A `vcpkg.json` file is used to define the dependencies for a C++ project. It can include a list of dependencies, as well as a `builtin-baseline` which specifies a particular commit of the Vcpkg ports repository to use for resolving dependencies.

The full reference can be found in the official documentation: <https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json>.

## Dependency Graph Extraction Challenges

Extracting the dependency graph for Vcpkg is quite challenging due to the way Vcpkg handles dependencies and its integration with CMake.

The following options were considered for implementing the Vcpkg extractor:

1. **Standalone Methods**:
   1. **Parsing `vcpkg.json` (local only)**:\
      This file contains the list of dependencies for a Vcpkg project. However, it does not include transitive dependencies, which are crucial for a complete dependency graph.\
      Also there are no lock files in Vcpkg that could be used to get the full dependency graph.
   2. **Parsing `vcpkg.json` (local & transitive)**:\
      This approach would involve recursively parsing the `vcpkg.json` files of all dependencies to build the full dependency graph.\
      However, this is not feasible due to older versions of Vcpkg, which did not include `vcpkg.json` files for all ports (e.g. <https://github.com/microsoft/vcpkg/tree/3426db05b996481ca31e95fff3734cf23e0f51bc/ports/gtk>). Instead they used CMake files, which are much more difficult to parse and extract dependencies from.
2. **Methods using the [vcpkg-tool](https://github.com/microsoft/vcpkg-tool)**:
   1. **Using `vcpkg install [--dry-run] [--only-downloads]`**:\
      This command would be easy to use, as it provides all dependencies and their versions reliably. It even generates `vcpkg.spdx.json` files for easy dependency analysis.\
      However, it is platform dependent (cross compilation is not supported for all combinations) and requires external tools (CMake, compilers, Visual Studio for windows, etc.).
   2. **Using `vcpkg depend-info`**:\
      This command provides a graph of dependencies, however it neither includes version information nor platform information (so all dependencies for all platforms are listed).
   3. **Using `vcpkg x-package-info [port] --x-json`**:\
      This command provides a JSON representation of the specified port(s). It supplies registry port information in the local manifest context, including ports without a physical `vcpkg.json` file. This is not proof of the versions selected by an install resolver.\
      Native dependency and feature platform predicates remain in the result instead of being filtered against the analyzer host.\
      The main downside of this approach is the relatively complex parsing logic to extract all dependencies correctly and this only supports baselines up to `68a74950d0400f5a803026d0860f49853984bf11` (first commit of `versions/baseline.json`).

For this implementation, the last approach was chosen. The format 2 graph records
registry candidates with unknown selection; see [result semantics](../RESULT.md).
Target/host views remain distinct and no resolved feature union is inferred.

With this we can extract the dependency graph as follows:

```mermaid
flowchart LR
    A[local vcpkg.json] --> B[Extract dependencies]
    B --> C["vcpkg x-package-info --x-json [all X-level dependencies]"]
    C --> B
    C --> D[Construct dependency graph]
```
