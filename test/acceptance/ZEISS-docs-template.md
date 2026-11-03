# ZEISS+docs-template format 2 acceptance

Pinned commit `5241515eb3e8d133775107f75e82f1b49c5d5948`, tree `af582e1a794951e4b8bde6829c4de5f0f4798eb1` and
source archive SHA-256 `9e4f0cf2a0e51473df867bf088c9c1f1bf12304ff807be7e0f7a9bd0d2f2beec` identify the inspected
superproject source. An independent reconstruction verified full source bytes and
file modes against that tree. Matching input discovery found exactly:

- `package-lock.json` (SHA-256 `f037e0a0753c7c5d5dc08b0289f3c47010e23f5cc7245d851af5d627a6c3cb0f`)
- `package.json` (SHA-256 `86ddd70373c9bcd7986dfc1a267934534280781f3ca09b58a84b1b7a135a0a1c`)

All sixteen configured extractors ran with Node 22.23.4, pnpm 10.24.0 and
Vite+ 1.3.0. Result: 1 observations, 1 exact subjects,
784 catalog identities, 844 native npm placements and 1778 edges.

`test/zeiss-acceptance.test.ts` compares every native placement, version, artifact,
request and nearest ancestor target, plus exact graph counts and project/scope
roots. It checks native optional and peer selection, platform predicates, complete
request enumeration and catalog coverage. This uses original lock and manifest
inputs, without translating the old relationship baseline.

No extraction issues or separate drift declaration observations were reported.

These observations describe recorded locks and current declarations, not a current
installation. No package installation or resolver execution was used for acceptance.
