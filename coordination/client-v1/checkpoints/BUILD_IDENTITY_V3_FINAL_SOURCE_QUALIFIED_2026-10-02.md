# METAENGINE Browser Build Identity V3 final source qualification — 2026-10-02

Exact source head: `245920c1a45851a1d30c25341ce2ca33457bc5c7`  
Implementation branch: `work/build-lockfile-material-v1`  
Stack base: PR #1092 / `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Reserved package identity: `0.7.0-dev.36980000001.1`

This is a **source-only qualification checkpoint**. No Package Smoke physical producer had been started for this head/version when this checkpoint was created. It grants no release, promotion, install, update, Supervisor, Guardian, or fleet authority.

## Exact source qualification

Workflow:
- `Browser Build Identity V3 Source Qualification`
- run id: `36987601247`
- run number: `19`
- exact head: `245920c1a45851a1d30c25341ce2ca33457bc5c7`
- conclusion: **SUCCESS**

Focused Linux supply-chain contract:
- **58 / 58 pass**
- fail: 0
- skipped: 0

Full Windows Browser regression:
- **3911 / 3911 pass**
- fail: 0
- skipped: 0
- source checkout unchanged at terminal fence

## Frozen Browser material

- Node: `v24.21.0`
- npm: `11.19.0`
- Electron: `44.0.0`
- electron-builder: `26.15.7`, committed exact devDependency and invoked from local `node_modules\.bin`
- package-lock SHA-256: `0e90ce9b7928debfbbda537104411fb4d8d98dfb0e21e1816335a4460ad73be3`
- package-lock bytes: `144647`
- package entries: `317`
- installed dependency count: `501`
- dependency-resolution SHA-256: `1e68dcc723bdf3aabb5af6bcc3e3a7e31cc03a9e8c8523498069350b0054e8cf`

Two clean Windows `npm ci` passes produced the same lock and installed-tree identity.

## Frozen Bun / ME2 UI material

- setup-bun action pinned to `0c5077e51419868618aeaa5fe8019c62421857d6`
- Bun: `1.3.3`
- observed revision: `1.3.3+274e01c73`
- ME2 UI lock: committed `bun.lock`, LF-normalized
- install primitive: `bun ci`

Both source qualification and physical Package Smoke source now build the ME2 UI from a temporary source copy rather than mutating the tracked checkout. The physical Package Smoke path also:
- hashes the source and copied UI lock before install;
- refuses lock-copy drift;
- refuses `bun ci` lock mutation;
- checks native command exit codes;
- verifies the temporary bundle before staging;
- re-verifies the staged Browser resource bundle.

## V3 provenance closure

The exact source now additionally binds the locally verified electron-builder version into installer provenance:
- Package Smoke passes `--builder 26.15.7`;
- V3 provenance write refuses mismatch against Build Identity;
- V3 provenance read refuses builder-version drift;
- V2 historical provenance compatibility is unchanged.

The source contract includes explicit tests for this boundary.

## One-built physical boundary

The branch remains unconsumed until the stacked PR is opened and a `Browser Windows Package Smoke` runner starts.

After the physical runner starts:
- `0.7.0-dev.36980000001.1` is consumed if any source correction becomes necessary;
- no workflow rerun is permitted as a substitute for a new source/version;
- downstream installed-chat/final-runtime/soak/self-update consumers must consume the one exact Package Smoke artifact.

## Research successor

V4 research remains separate on `analysis/build-supply-chain-v4-attestation-v1`.

Current research direction:
- npm/CycloneDX or SPDX SBOM as evidence;
- composed installer SBOM;
- Bun/Electron runtime-material digests;
- GitHub/Sigstore attestations at release/promotion boundary only;
- no attestation authority in ordinary draft Package Smoke.

authority_effect=false
live_install_effect=false
