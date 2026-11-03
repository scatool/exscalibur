# ZEISS+playwright-web-scraping format 2 acceptance

Pinned commit `f9094e85365f60c2ab5ea2555f04b9959675d18a`, tree `eb6b89295d2f870cfbf486c866db4280f17422fb` and
source archive SHA-256 `85b429aa0412f07512386e03253995fb5b016df340076906d3f86159520d6ba8` identify the inspected
superproject source. An independent reconstruction verified full source bytes and
file modes against that tree. Matching input discovery found exactly:

- `node/package-lock.json` (SHA-256 `013ddb2ab0e7c315c7f0989a6b6e3d32bfb9566dd031fa55c706a2d34335e9fe`)
- `node/package.json` (SHA-256 `64e1879df42345810d983629bac87677027141d71cbbd3f67c4565d4327d98f1`)
- `package-lock.json` (SHA-256 `d3263f5b86e5115e2889fe38928d838fad318181ef3aa18fd8cd4d6d2d069beb`)
- `package.json` (SHA-256 `85f04e4c2c2506fa9f5a4d45f3b5a82c2c1f3cba256fe77f7735b6acbca62ddf`)
- `python/requirements.txt` (SHA-256 `a188b3e7e65be32db700d668b768b794cb0af81022c17a93950e21cad2c962e1`)

All sixteen configured extractors ran with Node 22.23.4, pnpm 10.24.0 and
Vite+ 1.3.0. Result: 4 observations, 4 exact subjects,
256 catalog identities, 258 native npm placements and 524 edges.

`test/zeiss-acceptance.test.ts` compares every native placement, version, artifact,
request and nearest ancestor target, plus exact graph counts and project/scope
roots. It checks native optional and peer selection, platform predicates, complete
request enumeration and catalog coverage. This uses original lock and manifest
inputs, without translating the old relationship baseline.

Current manifest drift remains a separate declaration observation and warning; locked placement facts remain independent. The unnamed node manifest has a synthesized subject distinct from the locked pkg:npm/node subject; the Python input retains an unresolved playwright declaration and unknown closure.

These observations describe recorded locks and current declarations, not a current
installation. No package installation or resolver execution was used for acceptance.
