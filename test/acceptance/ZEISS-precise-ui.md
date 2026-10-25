# ZEISS+precise-ui format 2 acceptance

Pinned commit `d224258bfd28305c9c6776b3397235e28a939ac6`, tree `c9e4d7f997e1f5b3935fb92a3a0419b635253fb0` and
source archive SHA-256 `491c39734e6358e52d387ac8a0b52ba39782efc40cc541877ff2cd880ef14ee5` identify the inspected
superproject source. An independent reconstruction verified full source bytes and
file modes against that tree. Matching input discovery found exactly:

- `package-lock.json` (SHA-256 `c6466afcf057df47c38d8b9b4cfef2bcde5d338ef4360d8c720284e58ea46b94`)
- `package.json` (SHA-256 `dea8e9587ba27297915317dd7f89f6e4c7b800c55e39289edb84401440e0c581`)

All sixteen configured extractors ran with Node 22.23.4, pnpm 10.24.0 and
Vite+ 1.3.0. Result: 1 observations, 1 exact subjects,
1556 catalog identities, 2326 native npm placements and 4745 edges.

`test/zeiss-acceptance.test.ts` compares every native placement, version, artifact,
request and nearest ancestor target, plus exact graph counts and project/scope
roots. It checks native optional and peer selection, platform predicates, complete
request enumeration and catalog coverage. This uses original lock and manifest
inputs, without translating the old relationship baseline.

No extraction issues or separate drift declaration observations were reported.

These observations describe recorded locks and current declarations, not a current
installation. No package installation or resolver execution was used for acceptance.
