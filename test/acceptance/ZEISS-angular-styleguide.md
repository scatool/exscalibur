# ZEISS+angular-styleguide format 2 acceptance

Pinned commit `5051c157c066e3f529f6a63971cbe64b072685b8`, tree `800e1de31058226d91c843d361bc30b60f7e5aea` and
source archive SHA-256 `a1d41186376da333098b42e5e29efb0df3f491dbe5cb4c67ce40c34456e0f3f7` identify the inspected
superproject source. An independent reconstruction verified full source bytes and
file modes against that tree. Matching input discovery found exactly:

- `package-lock.json` (SHA-256 `6c8789e7f5564113c11fbc172a07723bc5974f3ffc474a910dac4ffbf08e605c`)
- `package.json` (SHA-256 `be131d0b1b2c5c76000bcfa12b9f5fdfad23d152a0281680e1a495d61b08a072`)

All sixteen configured extractors ran with Node 22.23.4, pnpm 10.24.0 and
Vite+ 1.3.0. Result: 2 observations, 1 exact subjects,
1582 catalog identities, 1969 native npm placements and 3859 edges.

`test/zeiss-acceptance.test.ts` compares every native placement, version, artifact,
request and nearest ancestor target, plus exact graph counts and project/scope
roots. It checks native optional and peer selection, platform predicates, complete
request enumeration and catalog coverage. This uses original lock and manifest
inputs, without translating the old relationship baseline.

Current manifest drift remains a separate declaration observation and warning; locked placement facts remain independent.

These observations describe recorded locks and current declarations, not a current
installation. No package installation or resolver execution was used for acceptance.
