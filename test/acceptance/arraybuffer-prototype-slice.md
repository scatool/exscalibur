# ArrayBuffer.prototype.slice format 2 acceptance

Pinned source is `es-shims/ArrayBuffer.prototype.slice` at commit
`b781900adb00d1fdf04b562c7ba0536b85dd0537`, Git tree
`ed05cc839660c1016dc6defa9e54c8211a3bcf79`. All 24 source files were
checked against Git blobs and file modes. The restoration-only `.gitkeep`
is excluded. The source archive SHA-256 is
`510972cc8fa4854325d7f580625630fd85e5dd3d2907700828ce66e9cab50825`.

The only matching input for the configured 16 integration extractors is
`package.json`, SHA-256
`19489eaebd7e2bf6603d8f6bd32462f315249fe1cccd8931043eacdcb02838ed`.
All 16 extractors were executed with Node.js 22.23.4, pnpm 10.24.0 and
Vite+ 1.3.0. Only `packagejson` produced a graph; no issues were reported.
No package installation or native dependency resolution was performed.

Source-backed assertions, independently reviewed and reproducible in
`test/integration-acceptance.test.ts`, verify all seven runtime and seventeen
development declarations against the exact manifest names and specifiers.
The project is `pkg:npm/arraybuffer.prototype.slice@1.0.4`, with four exact
scope roots and five project views. Each declaration is selected in its scope,
without a resolved target, fabricated package version, or predicate.
The catalog is empty. Nonempty scope closures retain unknown resolution
completeness; empty optional and peer closures are complete. The consumer
view retains unknown dependency completeness.

The legacy baseline is not a semantic oracle. This acceptance covers the
configured extractors and source declarations, not installed versions or
transitive dependency resolution. Baseline and source hashes are recorded
separately from the historical baseline hash in `integration-migration.json`.
