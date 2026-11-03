# Conan dependency observations

`extractor` runs `conan graph info`.
`convertConanGraph` consumes its native JSON directly. Native node IDs remain
separate even when their PURLs coincide: host/build context, package IDs, binary
revision, settings and options belong to those views. Recipe user/channel and
revision participate in package coordinates. Missing versions stay absent.

Only `direct` requirements introduce immediate adjacency. Conan's transitive
requirement records are not additional direct edges. Native requirement traits,
including binary `skip`, remain request metadata; skipping a binary does not prove
that a dependency was excluded. Missing targets remain unresolved, while absent
node dependency records retain unknown adjacency. Missing directness retains
unknown selection rather than claiming an immediate selected binding.

Each imported consumer/editable subject has an exact `(PURL, input#node)` identity.
Its runtime/build/test roots have separate project views; consuming that subject
follows its native view, not all scope roots. Scope names preserve the existing
extractor's mapping of Conan test/build/runtime traits. These are recorded graph
requirements, not runtime or installed-artifact claims. Command/parse failures
remain issues with unknown coverage via the core file extractor.
