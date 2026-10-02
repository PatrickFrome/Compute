# Build Identity V3 / frozen Browser toolchain — terminal physical qualification

Qualified runtime source: `d283150bc8a3338a76b98c369b67fb7e846b207b`  
Runtime branch: `work/build-lockfile-material-v1`  
Draft PR: #1094  
Evidence branch: `analysis/build-identity-v3-qualified-d283150`  
Qualified package: `0.7.0-dev.36990000001.1`

This checkpoint is evidence-only. It does not mutate the tested runtime source, live user installation, release authority, Guardian authority, Supervisor admission, or task authority.

## Exact-head matrix

All **10/10 triggered workflows are terminal SUCCESS**:

- Host Resilience Login Start #515 / run `36989661349`
- Workspace Reincarnation #567 / run `36989661263`
- Critical Audit #2603 / run `36989661288`
- Browser Shell #3550 / run `36989661310`
- Shell-First Dirty Profile #1038 / run `36989661440`
- Package Smoke #3145 / run `36989661754`
- Autonomous Soak #2679 / run `36989661490`
- Installed Chat #2427 / run `36989661580`
- Final Runtime #2010 / run `36989661249`
- Self Update E2E #3598 / run `36989661499`

Browser Shell:
- primary suite: **3911 tests / 3909 pass / 0 fail / 2 skipped**
- additional shell contract: **102/102 PASS**

Critical Audit:
- **3911/3911 PASS**
- 0 fail
- 0 skipped

## Source-only toolchain qualification

Pre-physical source qualification:
- workflow: Browser Build Identity V3 Source Qualification #20
- run: `36988959137`
- conclusion: SUCCESS
- focused V2/V3 supply-chain suite: **58/58 PASS**
- Windows full Browser regression: **3911/3911 PASS**
- Node: `v24.21.0`
- npm: `11.19.0`
- Bun: `1.3.3`
- Bun observed revision: `1.3.3+274e01c73`

Two clean Windows `npm ci` installs produced the same dependency material before the physical PR was opened.

## One physical producer

Package Smoke:
- run id: `36989661754`
- run number: **3145**
- attempt: **1**
- source: `d283150bc8a3338a76b98c369b67fb7e846b207b`

Version reservation:
- artifact id: `11219371368`
- bytes: **861**
- ZIP SHA-256: `abece6a8f063a1187379ce2cc0e85d8ef7970c10ec0abf2e9b724409e781b2d5`

Candidate:
- artifact id: `11219141925`
- bytes: **158406424**
- ZIP SHA-256: `06b41a1c20f89dadbfc2740b64d842b9d301044412b355122f16ab6753771d7c`

Package evidence:
- artifact id: `11219765616`
- bytes: **622671**
- ZIP SHA-256: `24f8f9832a1456ea00d6c67399b73664ae0d013ccb41b9486f462b760d3eb582`

Installer:
- `METAENGINE-Browser-Test-Setup-0.7.0-dev.36990000001.1-x64.exe`
- bytes: **156364287**
- SHA-256: `b68b71767cd32d147c2d62325be9ab9ff794c7aaa2a2460daee89d7021252473`
- blockmap SHA-256: `b27ba75c89fbe09b7e9d698053ffd1c09a3e69cf248858dbc3d046034b0f5901`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance schema: `metaengine.browser.installer-provenance.v3`
- provenance id: `f792965b-de24-4f28-bbc2-1e9227e7f808`
- signed: false
- published: false
- promotion authorized: false

## Build Identity V3

Build Identity SHA-256:
`cb275d3997c284d2f849d532f6e474c135018229ecbcdae82150d5038e4319e2`

Frozen declared Browser material:
- package-lock SHA-256: `a167e95a1d41d5afcb13861669ce61887fe64c14a3466a186535d901ef9bb0f3`
- package-lock bytes: **144647**
- lockfileVersion: 3
- lock package entries: **317**
- npm: `11.19.0`
- Node: `v24.21.0`

Observed installed Browser dependency material:
- dependency-resolution SHA-256: `44db8c97004e4655d85cd0f775ad5df136841dc1f1b1cd55a2ec816a461cda51`
- dependency count: **501**

Build toolchain:
- electron-builder: `26.15.7`, installed from the committed Browser package-lock
- Package Smoke invokes only the local locked electron-builder binary
- no npx electron-builder fallback

ME2 UI / daemon toolchain:
- Bun: `1.3.3`
- ME2 UI bun.lock SHA-256: `a81d5c2c173747ba19a5461f16485895fabb7aa5f740b95645cb01891547ba81`
- ME2 daemon version: `0.57.1`
- packaged daemon executable SHA-256: `f0f37f20096bc09045d2740f2c2dbbe7bbc43c250a0aaf76228b6eb25b2df339`

The V3 identity also binds repository/repository-id, exact source SHA, workflow, run id/attempt, package version, platform/arch and builder config digest.

## Package physical proof

Package Smoke verified:
- independently computed expected V3 identity == beforePack identity == packaged app.asar readback;
- installed ME2 UI;
- installed ME2 daemon;
- Guardian native staging;
- normal primary ME2 shell;
- R97 DOM contract;
- second-instance activation;
- runtime import observability;
- startup grace: **190 seconds**;
- same primary PID across startup grace: true;
- same Sentinel token across startup grace: true;
- parent progress advanced: true;
- Sentinel relaunch attempted: false.

Guardian installed staging manifest SHA-256:
`67b652bac2211cedac2d951e9f2c564e6b28786ee34ae482d32ce332d0b7f6b7`

## Installed Chat #2427

Artifact:
- id: `11219337999`
- bytes: **156293593**
- ZIP SHA-256: `f0ba5848c005f7b6357f083c3dea7982ac0c1cbcfa2622fe710c93ca1452b71a`

Installed Chat acquired and reverified the exact Package Smoke producer before execution:
- installer SHA matched;
- Build Identity V3 matched;
- dependency-resolution matched;
- package-lock matched and was reverified;
- npm/Bun/UI lock matched;
- blockmap/config matched.

Physical qualification:
- clean genesis verified;
- automatic initial tab suppressed;
- automatic initial remote load suppressed;
- persistent preconnect armed;
- primary shell mode: `ME2_PRIMARY`;
- OIDC enrollment qualification: true;
- OIDC nonce bound: true;
- OIDC token exposed to Browser: false;
- ADMIN connection verified: true;
- ADMIN access tier: `ADMIN`;
- backend transport: `POSTGREST_RPC`;
- automatic reconnect: true.

The exact producer terminal gate subsequently succeeded.

## Final Runtime #2010

Artifact:
- id: `11219601766`
- bytes: **156291128**
- ZIP SHA-256: `84d349085652073148e71fc64a0612e21bdb09303f3dcadbb01dd11ec4e1ca82`

Runtime lifecycle:
- state: `READY`
- Host Agent: `READY`
- signer: `READY`
- host runtime: `READY`
- transport active: true
- typed Browser IPC: true
- verified execution outcomes: true
- fast control read side: true
- fast control production mutation authority: false
- second scheduler: false
- automatic effect retry: false
- authority effect: false

Host identity remains:
`WAITING_FOR_ENROLLMENT`

This is preserved as an open boundary and is not rewritten as success.

## Autonomous Soak #2679

Artifact:
- id: `11219099079`
- bytes: **156351671**
- ZIP SHA-256: `17467cf41a50cbd8ed072900f5c95fa644baff6b7ec8f5d9a622441f8be5b773`

Installed runtime:
- 72/72 second-instance activations
- 64 sequential + 8 concurrent
- activation p95: **143.87 ms**
- p95 budget: 1000 ms
- 8-process concurrent burst: **491.67 ms**
- working-set growth: **0**
- handle growth: **+10 / +24 budget**
- duplicate Browser runtime: false
- redundant durable second-instance markers: 0

Brain endurance:
- 1,000,000 semantic edges
- 128 BrowserCells
- 128 agents
- **126,376 semantic edges/s**
- 32 peak parallel mutation lanes
- bounded cell facts: 2048
- second scheduler: false
- automatic effect retry: false

Continuous 100k, 2,000 tasks / 2,048 peers and all configured chaos seeds passed.

## Self Update #3598

Artifact:
- id: `11219731724`
- bytes: **157459373**
- ZIP SHA-256: `848876964fc36d54e99e630f7816c9360dc06fdc83d29874c59aecaac4e9e1f3`

Backward-compatibility fixture:
- historical V2 binding accepted correctly;
- installer tampering rejected;
- producer-attempt drift rejected;
- binding digest drift rejected;
- dependency proof tampering rejected;
- handled native exit state cleared;
- installer not executed by the negative fixture.

Self Update acquired the exact V3 Package Smoke artifact.

Fast update:
- baseline: `0.7.0-dev.36806234662.1`
- target: `0.7.0-dev.36990000001.1`
- exact source: `d283150bc8a3338a76b98c369b67fb7e846b207b`
- result: `FAST_SELF_UPDATE_PASS`

Resident Browser + Sentinel upgrade:
- legacy version: `0.7.0-dev.34759310781.1`
- legacy Browser/primary gone: true
- legacy Sentinel gone: true
- target installer SHA-256: `b68b71767cd32d147c2d62325be9ab9ff794c7aaa2a2460daee89d7021252473`
- expected installed executable SHA-256: `ab5e8f1e6ba6133a5173c266d4873458ee0f8e9c5a0087134827f53da8f7ac9d`
- installed executable SHA-256: exact match
- new Browser/primary started: true
- new Sentinel started: true
- planned shutdown verified: true
- retry dialog required: false
- authority effect: false

The exact Package Smoke producer terminal gate succeeded after physical update proof.

## Qualification conclusion

Build Identity V3 and frozen Browser build-toolchain qualification is terminal green.

The exact qualified physical chain now proves:
1. one source/version -> one Package Smoke producer;
2. Browser npm dependency graph frozen by committed package-lock + npm ci;
3. electron-builder graph included in that same lockfile;
4. exact installed npm tree rederived independently;
5. Bun version and ME2 UI bun.lock bound;
6. package identity injected and reread from packaged app;
7. one exact installer feeds every physical consumer;
8. historical V2 consumer compatibility remains intact;
9. Self Update works for both fast update and resident Browser+Sentinel replacement.

## Remaining external-input boundary

This is strong frozen provenance, not a claim of hermetic or bit-reproducible builds.

Still external:
- GitHub-hosted runner image / OS;
- Electron/runtime downloads and external binary resources consumed by the locked toolchain;
- Windows toolchain/NSIS environment.

The next supply-chain stage should therefore add evidence/authenticity around the already-qualified artifact rather than claiming full hermeticity.

## Next research/implementation direction

Separate research line:
`analysis/build-supply-chain-v4-attestation-v1`

Current recommendation:
- add evidence-only SBOM first;
- compose installer-wide SBOM;
- use current `actions/attest` at the release/promotion boundary, not during ordinary draft Package Smoke;
- pin the attestation action to an exact commit;
- keep internal Build Identity + installer SHA + physical qualification as independent mandatory gates.

PR #1094 remains draft. Terminal qualification does not itself authorize merge, release, promotion, or live user-machine installation.
