# METAENGINE Browser Build Identity V3 source qualification checkpoint — 2026-10-02

Exact qualified source head: `ae2d7983302d772d90c7404e76b304226c9f6a0f`  
Implementation branch: `work/build-lockfile-material-v1`  
Qualified predecessor: PR #1092 / `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Reserved package identity: `0.7.0-dev.36980000001.1`

This checkpoint is source-only evidence. It does **not** claim that the package identity has been physically built, installed, promoted, published, or released. It grants no Supervisor, Guardian, update, release, or production authority.

## Source qualification

Workflow:
- `Browser Build Identity V3 Source Qualification`
- run id: `36986237981`
- run number: `17`
- conclusion: **SUCCESS**
- exact head: `ae2d7983302d772d90c7404e76b304226c9f6a0f`

Linux focused supply-chain contract:
- 55 tests
- 55 pass
- 0 fail
- 0 skipped

Windows full Browser regression:
- 3908 tests
- 3908 pass
- 0 fail
- 0 skipped
- tracked source checkout remained unchanged after qualification

## Frozen Browser dependency material

Node: `v24.21.0`  
npm: `11.19.0`  
Electron: `44.0.0`  
electron-builder: `26.15.7`

Committed Browser package-lock material:
- lockfile schema: `metaengine.browser.package-lock-material.v1`
- package version: `0.7.0-dev.36980000001.1`
- package_lock_sha256: `0e90ce9b7928debfbbda537104411fb4d8d98dfb0e21e1816335a4460ad73be3`
- package_lock_bytes: `144647`
- package entries: `317`
- integrity entries: `317`
- resolved entries: `317`

Observed installed dependency resolution:
- dependency_count: `501`
- dependency_resolution_sha256: `1e68dcc723bdf3aabb5af6bcc3e3a7e31cc03a9e8c8523498069350b0054e8cf`

The Windows qualification performed two clean `npm ci` installs and obtained the same lockfile and installed-tree digests.

## Frozen Bun / ME2 UI material

setup-bun action is commit pinned:
`oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (v2.2.0)

Bun requested version:
`1.3.3`

Observed source-run revision:
`1.3.3+274e01c73`

ME2 UI:
- committed text `bun.lock`
- `.gitattributes` forces `bun.lock text eol=lf`
- `bun ci` is used for frozen install
- UI build/pack verification succeeded on Windows
- source qualification builds the UI from `RUNNER_TEMP`, not the tracked checkout

ME2 daemon:
- compile uses the pinned Bun runtime when `ME2_BUN_TOOLCHAIN_REQUIRED=true`
- no legacy dependency graph is installed merely to build the probe-only Browser compatibility executable

## V3 identity/provenance contract now covered by source tests

The V3 source contracts prove:
- raw Browser package-lock SHA is bound separately from the installed dependency tree digest;
- Node/npm toolchain drift fails closed;
- electron-builder is a committed exact devDependency and Package Smoke invokes only the local locked binary;
- Bun version is bound;
- ME2 UI bun.lock SHA is bound;
- Package Smoke still has one physical NSIS producer;
- V2 provenance remains readable for already-created historical artifacts;
- qualified downstream consumers require and reverify V3 package-lock and UI-lock evidence;
- all new evidence fields remain `authority_effect:false`.

## Important remaining boundary before first V3 physical Package Smoke

The physical Package Smoke source still builds ME2 UI in the tracked checkout. Source qualification exposed why that is undesirable: Next build output can replace/delete tracked generated `.next` paths.

Before opening the V3 PR and consuming `0.7.0-dev.36980000001.1`, the next safe source change is:
1. isolate the **physical Package Smoke** UI build into `RUNNER_TEMP`;
2. add explicit native-command exit checks for `bun ci`, `bun run build`, and pack;
3. stage only the verified temp bundle into Browser resources;
4. rerun this source-only qualification on the new exact head.

Only then should the draft physical PR be opened.

## Research successor

Separate research branch:
`analysis/build-supply-chain-v4-attestation-v1`

Current V4 research records:
- Bun revision/runtime-binary material as a future stronger builder proof;
- Electron runtime binary digest as a future material proof;
- npm/CycloneDX SBOM;
- composed installer SBOM;
- GitHub artifact attestation only at release/promotion boundary, not ordinary draft Package Smoke.

No live browser install was attempted by this checkpoint.
