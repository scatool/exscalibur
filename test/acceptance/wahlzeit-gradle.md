# Wahlzeit native Gradle graph acceptance

Reviewed `evorto/wahlzeit` at commit `7a0ae08deb62b9a9ad5d132cb5ac7d69420c9959`,
Git tree `ee9695b68954860c89765e3147499894c728bdad`. The supported downloader acquired
the pinned superproject archive, SHA-256
`fc693b71b2953c473afd49cfcde3534d8b7288504ac713127c17b980b5dc3340`.
The GitHub Git tree API independently confirms the tracked tree. Root `build/` and
`.gradle/` are generated Gradle output, absent from that tree; acceptance reconstructs
the full source tree while excluding only these generated directories.

## Native execution

Used the unchanged repository Gradle 6.6.1 wrapper with Temurin JDK 11.0.32+101.
Java 11 is explicitly required by the integration case, in addition to the Java 21
workspace toolchain. The existing system certificate store and environment proxy
were selected only for JVM test processes with explicit user approval. TLS and
hostname verification remained enabled; no certificates, global settings or saved
environment settings changed.

The extractor ran `project-info.gradle` and the existing dependency graph init
script, using `org.gradle:github-dependency-graph-gradle-plugin:1.4.0`. The native
commands succeeded. `gradle-native-wahlzeit.json` captures project metadata and all
20 native configuration records; only the metadata build-file path is relativized
to `build.gradle`. The dependency snapshot preserves all 329 native dependency
records, including the eight exact repeats. This is native evidence, not a
conversion of the analyzer baseline.

## Source and semantic comparison

The build applies Java, War and Gretty 3.0.8, using its declared JCenter repository.
The source declares servlet-api 4.0.1 as providedCompile; PostgreSQL
9.3-1104-jdbc41, log4j 1.2.17 and javax.mail 1.6.2 as implementation dependencies;
and JUnit 4.12 as testImplementation. The native runtime/test/provided configuration
observations are compared against these declarations and their native transitive
adjacency. Gretty runner and buildscript observations remain separate configurations;
they are not all claimed to be application runtime dependencies.

The native snapshot repeats the entire servlet-api record twice in each of eight
configurations. Both records have identical identity, origin, direct/project flags,
coordinates, repository and adjacency. The converter now collapses only completely
equal repeated records. Conflicting facts under the same ID still fail; adjacency
is never unioned, directness is never widened, and configurations are never merged.

The accepted result has 205 catalog identities, one synthesized project subject,
20 separate graphs and 466 graph-local edges. Native metadata reports empty group,
unspecified version and the harness directory-derived name `evorto+wahlzeit`;
`pkg:generic/evorto%2Bwahlzeit` is explicitly marked synthesized, not asserted as
published package identity. Repository qualifiers and configuration-local native
IDs are retained. No injected dependency-graph plugin node occurs in this capture.

Every configuration retains unknown root and dependency completeness and the
`dependency-graph-snapshot` / unknown variant-coverage attributes. A successful
native command does not establish variant-complete or effective runtime closure.
The empty detached configuration remains an observed scope, not proof that no
other scopes exist. This review does not claim execution of Wahlzeit application
tests, deployment, or compilation of all selected dependencies.

All sixteen existing harness extractors ran with the stable integration namespace;
only Gradle contributed output and no issues were reported. Independent review and
`test/gradle-acceptance.test.ts` compare source hashes, the pinned tree, native
configuration membership, identities, direct edges, complete captured adjacency,
and conservative scoped query results. The historical V1 hash is retained separately
from the accepted V2 hash. Registry changes must trigger investigation rather than
automatic baseline updates.
