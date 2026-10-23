# Analyzer result format 2

This document and [the JSON Schema](./analyzer-result-v2.schema.json) define the
serialized result contract. `formatVersion` remains **2** regardless of removal
of the legacy API. An extractor's `version` describes its callable interface and
is independent of this wire version.

## Encoding and values

A result is one UTF-8 JSON object. Required collections (`packages`, `subprojects`,
`graphs`, `issues`, and each graph's `roots`, `nodes`, `edges`) must be present,
including when empty. Object keys must be unique. Consumers accepting raw JSON
must reject duplicate keys before converting to an object; `parseResultV2` accepts
already decoded values and cannot detect keys discarded by an earlier decoder.

Absent optional fields mean unreported/unknown, never a default claim of false or
empty. `null` is only permitted inside arbitrary JSON values, such as attributes
or predicate expressions. It does not replace an absent typed field. For example,
absent `enabledFeatures` means unknown; `[]` means explicitly no enabled features;
`null` is invalid. An empty `edges` list proves a leaf only when the corresponding
view has `dependencyCompleteness: "complete"`. Empty roots do not establish complete
root enumeration unless `rootCompleteness` says so.

Numbers use finite IEEE 754 binary64 values. Integer values must be in
`[-9007199254740991, 9007199254740991]`. Larger integers (including native IDs and
counters) must be decimal strings; producers must preserve the source value before
converting it to binary64. Fractions have binary64 precision, not arbitrary decimal
precision. Encode exact decimals as strings when their precision matters. Negative
zero has the same semantic value as zero and serializes as `0`. NaN, infinities,
BigInt, undefined, sparse arrays, symbols, cycles and non-JSON objects are invalid.
Validation applies to extension fields as well as known fields.

## Structural and semantic validation

The schema is JSON Schema Draft 2020-12. It covers field shapes, required values,
selection/binding consistency and the numeric range. It is intentionally not a
standalone correctness oracle: consumers must additionally validate canonical
Package URLs; uniqueness of catalog PURLs, project `(purl, definitionFile)` keys,
graph IDs, and graph-local node/root IDs; and all graph-local references. Each root
must refer to a view of its exact project. A view without a project must reference
a catalog package. The TypeScript reference implementation is `parseResultV2`.

The removed V1 fields `relationships`, project `scopes`, and package `downloadLocation`
are rejected, as is the unscoped `synthesizedPurl` field. There is no legacy reader or
PURL-union compatibility conversion. Use contextual graphs and artifact descriptors.

Other unknown fields are preserved as additive JSON data. They must not redefine identity,
selection, applicability or reachability. Use namespaced keys within `attributes`
for ecosystem metadata. A new mandatory semantic interpretation requires a new
format version; readers must reject unsupported `formatVersion` values. A new
predicate language can be represented in format 2 because unsupported predicates
already evaluate to unknown, never true or false by default.

Catalog identity facts and observation assertions are distinct. `identityObservations`
associates each `synthesizedPurl` assertion with its extractor, input files and optional
native source key. Differing assertions from independent sources can coexist.
Neither a generic PURL nor a merged evidence list proves how every source obtained
that identity.

## Normalization and deterministic bytes

Normalization preserves absent fields, additive fields and native JSON array order.
Known set-like fields are sorted/deduplicated: evidence, source files, requested and
enabled features, artifacts, external references, identity observations, dependency
edges and issues. Catalogs sort by PURL, projects by `(purl, definitionFile)`, graphs
by ID, and graph nodes/roots by ID. Issue severity sorts ERROR, WARNING, HINT, then
by deterministic JSON text. Record sets compare deterministic JSON text. Normalization
must not union adjacency of distinct views or graphs.

The reference deterministic encoding is ECMAScript `JSON.stringify` without whitespace
or a trailing newline after recursively sorting object entries by UTF-16 code units.
ECMAScript object enumeration then emits array-index keys first, in numeric order,
followed by the remaining sorted keys. For example `{"10":0,"2":0,"a":0}` encodes
as `{"2":0,"10":0,"a":0}`. Strings and numbers use ECMAScript JSON escaping and
binary64 number formatting. This is **not RFC 8785/JCS**. Consumers need not reproduce
these bytes to consume results: object member ordering is semantically irrelevant.
Cross-language producers computing the reference content-derived graph IDs must
reproduce this encoding, including index-key enumeration and number rendering.

`createDependencyGraph` computes SHA-256 over UTF-8 deterministic JSON of the normalized
graph with `id` omitted, then prefixes the hex digest with `source.extractor + ":"`.
Graph IDs are otherwise opaque observation identities; consumers must not infer native
view identity or graph equivalence from a digest. Serialization of a complete normalized
result uses the same deterministic encoding. These conventions do not authorize
rewriting IDs in imported results.

## Conformance inputs

[wire-fixtures.json](./wire-fixtures.json) contains small language-neutral structural
accept/reject cases shared by the reference tests. Semantic graph invariants and
conservative query behavior are exercised separately in the core contract tests.
Passing these fixtures does not establish native extractor correctness.
