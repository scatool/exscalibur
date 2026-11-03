# ZEISS/htmx-template native acceptance

Pinned commit `080ce09c15567c6d90302f8047f1776cb70f53df`, tree `55827939258e85eae45aa85880c0a38bf3c4843b`, source archive SHA-256 `3a4b28bef76e70bfaa7539eb941cb50d04929ebbc36b98910d9bd8b0711022d1`. Independent verification checked the complete exported superproject source; gitlinks, where present, are explicitly bounded below.

Tools: Go 1.26.3 (linux/amd64), Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Go ran with `GOTOOLCHAIN=local` and external module/build caches; no toolchain auto-upgrade or source modification.

## Input evidence

- `go.mod` — SHA-256 `e78b95d7c6a67a3da2c2d2d9d7b4f4ac1ca3a623086527a0c983a0d642947eca`.
- `go.sum` — SHA-256 `b51ae753806d7e212469edd54b1acd5d9d129a858848c6684cd0d60315c5675e`.
- `package-lock.json` — SHA-256 `48d3fd30eca3d06ce024686b7c83789d645992be4943105882eeea712f729f71`.
- `package.json` — SHA-256 `b56af6084150cd64d2b79a45aafc412fbcfbe27d489898fe8705aa1582d05bee`.
- `tools/go.mod` — SHA-256 `b19c1e1e9debb331b95e81710a3e4ce6eeb4fdb77bc2f0e38075bc07b1aa9451`.
- `tools/go.sum` — SHA-256 `b3cec6205aaad64aba0dbd1576b0d9995491f2fc9f280178aff4e6281f744b96`.

## Native comparisons

Native Go1.26.3 commands go mod edit -json, go list -m -json all and go mod graph succeeded for all 2 valid module inputs; 707 selected module placements were compared directly against native output.

Each exact Go project has separate direct, indirect and build-list roots. Every selected module, replacement, requested version and selected-owner graph adjacency matches native command evidence; package adjacency and nonempty closure stay unknown because a module graph does not establish package import/runtime usage.

All sixteen configured extractors ran, yielding 4 independent graphs, 14 roots, 4050 edges, 671 catalog identities and 4 exact projects.

Native source hashes remained unchanged after commands and extraction. Go module cache and build cache are external to the pinned sources. Module proxy access succeeded; no environmental failure was accepted as a fixture issue.

Stable module selection facts exclude host cache paths and cache hydration metadata. The same Bat source was compared before and after downloading its selected golang.org/x/tools module: go list gained a local Dir field, which must not change the serialized observation.

All npm package placements, artifacts, native dependency requests, nearest-ancestor bindings, platform conditions, peer uncertainty and root ownership match native lock inputs. Separate current manifest declarations retain exact requests when npm.manifest_lock_mismatch reports drift.

Reproducible checks in `test/go-acceptance.test.ts` rerun native commands and compare selected modules, all scoped requests, build-list membership, retained unknown adjacency and mixed-language source inputs. Native Go tests separately exercise basic, monorepo and replacement fixtures. Acceptance does not establish installed packages or deployed artifacts, and the V1 baseline was not used as a semantic oracle.
