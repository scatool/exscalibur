# ory/kratos native acceptance

Pinned commit `4a07685e095034683c7bf8bf18dec784ac8e8109`, tree `36ee403b4f4332c75a1e294e92af6a7e27f73325`, source archive SHA-256 `d87a0dd00162da6e67e57c7763cf988324057a64fa7a1dcbb57f8a614d193e87`. Independent verification checked the complete exported superproject source; gitlinks, where present, are explicitly bounded below.

Tools: Go 1.26.3 (linux/amd64), Node.js 22.23.4, pnpm 10.24.0 and Vite+ 1.3.0. Go ran with `GOTOOLCHAIN=local` and external module/build caches; no toolchain auto-upgrade or source modification.

## Input evidence

- `go.mod` — SHA-256 `273a07508cf9f048c2b771cf0c741000ec882c97044d180e1b6a9863122b2c8f`.
- `go.sum` — SHA-256 `72659755862a5061747d18b605c823bcb20287dccd0324b86219a2a6c32a944e`.
- `internal/client-go/go.mod` — SHA-256 `07cf1f336025f3dfe8ef737c88f73302c6c63ec333ace3a9bcf098984cc10434`.
- `internal/client-go/go.sum` — SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `oryx/go.mod` — SHA-256 `eb304367268a753ee19d9dcef3d5e014c7bcdd01053bc396780a32398c98e988`.
- `oryx/go.sum` — SHA-256 `ca96ad7025db7c791e839620e84950b9db6a125bf2704887f0996ea63f08f5e2`.
- `oryx/package-lock.json` — SHA-256 `4da75bde41e93ed82ec6f187a1bc4a7d0598fc822541b52be802c960343ae1fd`.
- `oryx/package.json` — SHA-256 `063d2ce157a48e6fd32eb2ca51d2f4d6516f3d7cc4715207180896564b07e2ce`.
- `oryx/randx/strength/go.mod` — SHA-256 `c408743483839c57b2061b2c856ea020a16993ab18c5627b5659f2c6392a3c3c`.
- `oryx/randx/strength/go.sum` — SHA-256 `8de9fa48c0bb0e205efc8edf5e3f17523cde9dc636370ff367010fc47be48067`.
- `package-lock.json` — SHA-256 `33e7632e83327f0274bd7b1d0c1989c974b3bd330d5a3dc9e3eed9e7594b1ccd`.
- `package.json` — SHA-256 `60fb7e0fdb0ea99e574f58104c723b43f6da07af90ce0c5f15a66ceb062af51b`.
- `test/e2e/hydra-kratos-login-consent/go.mod` — SHA-256 `8094881a0ca9f755866ba38b5cd461e0b508a1ebc42cba50269f9e4687258f78`.
- `test/e2e/hydra-kratos-login-consent/go.sum` — SHA-256 `a67e679d6c257d0396817a5ce5a8ef8f48ac163000638f097bbea549e1a93f9e`.
- `test/e2e/hydra-login-consent/go.mod` — SHA-256 `b0913ddd3627b4adef0725d7ebca673bbcd24522483d943a8e9f01e18e28ab14`.
- `test/e2e/hydra-login-consent/go.sum` — SHA-256 `11174e94dbcee599549a69e0da76c0ef1dd51b8ddb423f14d5ce9ecfd1b6f413`.
- `test/e2e/mock/httptarget/go.mod` — SHA-256 `b801859f3a250adba9c28e1d272f31f03387159803a28bdf35bba9daaf37b339`.
- `test/e2e/mock/httptarget/go.sum` — SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `test/e2e/mock/webhook/go.mod` — SHA-256 `9a85c7c01e0899089e1f2ba6b8e7ef76a48ed9ccd5fec007090db35b85dd5389`.
- `test/e2e/mock/webhook/go.sum` — SHA-256 `4f4ca133083a70cad981f3d3e16e637fc71ca0a3db607c75289385bcebcc153c`.
- `test/e2e/package-lock.json` — SHA-256 `edd82285bf40eb7c16ee8005d94f6eb6e40d4f45595e3a2c48a511160e9a3036`.
- `test/e2e/package.json` — SHA-256 `79a310ed168d645dc0840ef8fc31c54ffa44b3d4a294b720ac2676cc7d2cfa13`.
- `test/e2e/proxy/package-lock.json` — SHA-256 `b9719d192e70105e9cf29c90d0341f94bd97ac4c5b1187aa3fc2ab57206c5fc8`.
- `test/e2e/proxy/package.json` — SHA-256 `be875123b1b022518856b912a6dfa24b3a4d271cbfe487003c8b2c8040a95956`.

## Native comparisons

Native Go1.26.3 commands go mod edit -json, go list -m -json all and go mod graph succeeded for all 8 valid module inputs; 1717 selected module placements were compared directly against native output.

Each exact Go project has separate direct, indirect and build-list roots. Every selected module, replacement, requested version and selected-owner graph adjacency matches native command evidence; package adjacency and nonempty closure stay unknown because a module graph does not establish package import/runtime usage.

All sixteen configured extractors ran, yielding 14 independent graphs, 48 roots, 7876 edges, 1274 catalog identities and 14 exact projects.

Native source hashes remained unchanged after commands and extraction. Go module cache and build cache are external to the pinned sources. Module proxy access succeeded; no environmental failure was accepted as a fixture issue.

Stable module selection facts exclude host cache paths and cache hydration metadata. The same Bat source was compared before and after downloading its selected golang.org/x/tools module: go list gained a local Dir field, which must not change the serialized observation.

All npm package placements, artifacts, native dependency requests, nearest-ancestor bindings, platform conditions, peer uncertainty and root ownership match native lock inputs. Separate current manifest declarations retain exact requests when npm.manifest_lock_mismatch reports drift.

Reproducible checks in `test/go-acceptance.test.ts` rerun native commands and compare selected modules, all scoped requests, build-list membership, retained unknown adjacency and mixed-language source inputs. Native Go tests separately exercise basic, monorepo and replacement fixtures. Acceptance does not establish installed packages or deployed artifacts, and the V1 baseline was not used as a semantic oracle.
