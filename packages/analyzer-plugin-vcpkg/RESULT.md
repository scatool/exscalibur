# vcpkg dependency observations

`extractor` reads the existing manifest and retrieves native registry port data
through the existing `x-package-info` command. `convertVcpkgPorts` consumes these
manifests directly. It does not reuse the legacy loader's name-keyed union of
features and host/target adjacency.

Registry metadata is not a native resolver result. The graph has `declared`
interpretation. References to retrieved registry versions have unknown selection
and are labelled `registry-candidate`; they must not be interpreted as selected
versions satisfying the recorded range. Missing candidates remain unresolved with
an issue. Port versions/revisions remain coordinates; missing versions stay absent.

Host and target views remain distinct. Platform predicates, source feature guards,
feature support conditions and conditional requested features remain native data.
`vcpkg:declaration` predicates use the declaring view and environment domain; the
core deliberately does not evaluate feature activation. Baseline, overrides,
default features and configuration remain on their source manifest view. No enabled
feature set or triplet is inferred. Target platform and include-all-features options
are retained as query inputs, not proof of native resolver selection. All recorded
platform alternatives are retained; a consumer must use an evaluator with sufficient
native semantics to query a particular environment.

This projection retains existing manifest/registry coverage, but conservatively
reports unknown effective resolution instead of reproducing the legacy loader's
potentially incorrect binding claims. A resolver-selected feature closure requires
stronger native output. Command/parse failures remain issues with unknown coverage.
