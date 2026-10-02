# Build Identity V2 qualification — 2026-10-02

Qualified runtime source: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`  
Runtime branch: `work/build-identity-v2-v1`  
Draft PR: #1091  
Evidence branch: `analysis/build-identity-v2-qualified-4c3dd26`

This checkpoint is evidence-only. It does not mutate the tested runtime source, live user installation, release authority, Guardian authority, or Supervisor admission.

## Exact-head matrix

All **10/10 triggered workflows are terminal SUCCESS**:

- Browser Windows Package Smoke #3138 / run `36973286796`
- Browser Windows Installed Chat Qualification #2424 / run `36973286703`
- Final Runtime Activation #2007 / run `36973286521`
- Windows Autonomous Soak #2676 / run `36973286722`
- Self Update E2E #3595 / run `36973286528`
- Browser Shell #3547 / run `36973286592`
- Critical Audit #2600 / run `36973286577`
- Shell-First Dirty Profile #1035 / run `36973286534`
- Host Resilience Login Start #512 / run `36973286557`
- Workspace Reincarnation #564 / run `36973286697`

Browser Shell:
- tests: **3870**
- pass: **3868**
- fail: **0**
- skipped: **2**

Critical Audit full Browser suite:
- tests: **3870**
- pass: **3870**
- fail: **0**
- skipped: **0**

Dirty Profile is SUCCESS, proving Build Identity V2 producer-only enforcement no longer breaks auxiliary electron-builder workflows.

## One-built Package Smoke producer

Producer:
- run id: `36973286796`
- run number: `3138`
- run attempt: `1`
- exact source: `4c3dd26f9d89bb5e5b04c1eb4a21a5c434dba86b`

Package:
- version: `0.7.0-dev.36974000001.1`
- installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36974000001.1-x64.exe`
- installer bytes: **159811185**
- installer SHA-256: `f37a5a9604c0dfbb5bf86fba2042ba2e211ac5064a9ac3efeb8e5896a37638bd`
- blockmap SHA-256: `53ed3791511572040c361f59a09601ca48398442298ccf52d9214ddcb304f640`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- installer provenance schema: `metaengine.browser.installer-provenance.v2`
- provenance id: `782fa136-66b6-4b02-88ed-a54bb70bbcb4`
- signed: false
- published: false
- promotion authorized: false

Build Identity:
- schema: `metaengine.browser.build-identity.v2`
- Build Identity SHA-256: `52d075fee4a9fe9729836481743857f75dc90566150b15d93137dc829290eeb2`
- dependency-resolution SHA-256: `d1b2a4df4cdf9faab60a66bd8c3b9dfa54cb9d2c1d836f3bc89309b7c32e8588`
- dependency count: **55**
- Node: `v24.21.0`
- npm: `11.19.0`
- electron-builder: `26.15.7`
- repository id bound: true
- exact run id/attempt bound: true
- authority effect: false

The independently computed pre-build identity, beforePack-injected identity and packaged app.asar readback all matched before candidate publication.

## Immutable artifacts

Package Smoke candidate:
- artifact id: `11212566508`
- ZIP bytes: `161276515`
- ZIP SHA-256: `1e19c4374f31d3e19cef9d68eefe0122fa53d5e3c06b1c292dff71f8c06ad9f1`

Package evidence:
- artifact id: `11213061104`
- ZIP bytes: `472772`
- ZIP SHA-256: `794b1f843080cce90db42325e7417efd6b316476f5fef0856d902a1085a2f1a8`

Installed Chat:
- artifact id: `11212472584`
- ZIP SHA-256: `f2e8584aa9bd47f1e351444739142566c433da9a0a2f2fc7cd247affef2caae2`

Final Runtime:
- artifact id: `11212527347`
- ZIP SHA-256: `c10a52331ecfa5243ca7dff8590f273c92187fad37e8ec21215c739e3faac66c`

Autonomous Soak:
- artifact id: `11212765865`
- ZIP SHA-256: `6c0725c787ecd933101ad7f8e72986629dfb0290f969b3cc20508635b7554537`

Self Update:
- artifact id: `11213430672`
- ZIP SHA-256: `68f55e6edbbad32147e0b78e64e4249a48c4c55586cecc9ee161535e3af7a07f`

## Package physical proof

Package Smoke verified:
- exact installed version probe;
- packaged Build Identity readback;
- installed ME2 UI;
- installed ME2 daemon `0.57.1`;
- Guardian native staging;
- normal primary ME2 UI boot;
- R97 DOM contract;
- second-instance activation;
- startup grace survival: **190 seconds**;
- same primary PID across startup grace;
- same Sentinel token across startup grace;
- parent progress advanced;
- no Sentinel relaunch;
- one-shot Guardian machine-bootstrap qualification.

Guardian bootstrap binding:
- bootstrap SHA-256 `5528d53ffe8aee96fe1422d923e4c5f3953f39242d96a5a25761c790b3e80768`
- bootstrap bytes `1283584`
- service SHA-256 `3464909e7a4f4b6a91059f8c16f86f032ba35c1fb20a459c6a857f760fecb700`
- configurator SHA-256 `bdb1db17ddffbfed1f22f7ba3e536cbb28748c8eceaf2f737e824d2d42195802`
- automatic retry allowed: false
- authority effect: false

## Installed Chat qualification

Installed Chat consumed and reverified the exact Package Smoke producer:
- installer SHA matched `f37a5a96…638bd`;
- provenance schema v2;
- Build Identity matched `52d075fe…0eeb2`;
- dependency proof matched `d1b2a4df…e8588`;
- installed ME2 UI and daemon verified;
- normal shell mode: `ME2_PRIMARY`;
- clean genesis verified;
- ADMIN connection verified;
- access tier: `ADMIN`;
- OIDC enrollment qualification verified;
- OIDC token exposed to Browser: false;
- automatic initial remote load suppressed.

## Final Runtime

Exact Package Smoke artifact reached:
- lifecycle: `READY`
- Host Agent: `READY`
- signer: `READY`
- host runtime: `READY`
- transport active: true
- typed Browser IPC: true
- verified execution outcomes active: true
- second scheduler: false
- automatic effect retry: false
- authority effect: false

The host identity remained `WAITING_FOR_ENROLLMENT`; this is not rewritten as a success claim.

## Autonomous Soak

Installed Browser:
- 72/72 second-instance activations
- sequential activations: 64
- concurrent burst: 8
- activation p95: **491.94 ms**
- p95 budget: 1000 ms
- concurrent burst elapsed: **462.98 ms**
- working-set growth: **0**
- handle growth: **+12**
- handle growth budget: +24
- duplicate Browser runtime: false
- redundant durable second-instance markers: 0

Brain/fleet:
- 1,000,000 semantic edges
- 128 BrowserCells
- 128 agents
- **96,844 semantic edges/s**
- 32 peak parallel mutation lanes
- bounded cell facts: 2048
- 100k continuous Brain: PASS
- 2,000 tasks / 2,048 peers: PASS
- all configured chaos seeds: PASS
- second scheduler: false
- automatic effect retry: false

## Self Update E2E

The corrected negative verifier fixture passed and explicitly proved:
`handled_native_exit_state_cleared=true`.

Self Update then acquired and reverified the same Package Smoke producer.

Fast physical update:
- baseline: `0.7.0-dev.36806234662.1`
- target: `0.7.0-dev.36974000001.1`
- source: `4c3dd26f…`
- result: `FAST_SELF_UPDATE_PASS`

Resident Browser + Sentinel upgrade:
- legacy version: `0.7.0-dev.34759310781.1`
- resident installer exit: 0
- legacy Browser gone: true
- legacy Sentinel gone: true
- target installer SHA-256: `f37a5a9604c0dfbb5bf86fba2042ba2e211ac5064a9ac3efeb8e5896a37638bd`
- expected installed executable SHA-256: `340354cc103b9234e82bace907907526bdc5947cf1c3b25e970e5522511e55a8`
- installed executable SHA-256: same
- new Browser started: true
- new Sentinel started: true
- planned shutdown verified: true
- retry dialog required: false
- authority effect: false

## What Build Identity V2 now proves

The exact physical installer is bound to:
- exact source SHA;
- stable repository identity;
- Package Smoke workflow;
- exact GitHub run id + attempt;
- package version;
- platform/architecture;
- builder config digest;
- actual installed dependency-resolution digest;
- builder version;
- Node version.

The same exact provenance is reverified by all physical consumer workflows before execution. Consumers then wait for the exact producer run/attempt to become terminal SUCCESS.

Build Identity remains evidence, not promotion authority.

## Remaining supply-chain gaps found by post-qualification research

Two successors are now justified.

### P0 — one-source / one-version / one-physical-build fence

Because run id/attempt is embedded into packaged bytes, a workflow rerun of the same source/version would deliberately create a different Build Identity and potentially different bytes under the same semantic Browser version.

Research checkpoint:
- `research/ONE_SOURCE_ONE_BUILD_COLLISION_RESEARCH_2026-10-02.md`
- `coordination/client-v1/checkpoints/ONE_SOURCE_ONE_BUILD_COLLISION_RESEARCH_2026-10-02.json`

Recommended first fence:
- Package Smoke run attempt must be 1;
- prior source-scoped candidate artifact from another run refuses a second physical package build;
- ambiguity/API failure fails before electron-builder;
- cross-head semantic-version collision remains a separately hardened reservation problem.

### P1 — frozen dependency input

Current Package Smoke records the actual installed npm tree but still resolves it with `npm install --no-package-lock`.

Research:
- `research/BUILD_IDENTITY_V3_FROZEN_DEPENDENCIES_AND_ATTESTATION_RESEARCH_2026-10-02.md`

Next dependency slice:
- commit reviewed Browser package-lock;
- switch Package Smoke to `npm ci`;
- bind lockfile SHA-256 into Build Identity;
- retain actual installed-tree SHA-256 as independent post-install readback;
- only later add release-boundary GitHub artifact attestation/SBOM.

## Live-runtime boundary remains separate

Fresh Supabase observation still showed the user's installed Browser on an older version `0.7.0-dev.36908273822.1`.

It is healthy at the Compute/Development Plane level, but its four z.ai fleet agents are currently `BOUND_UNVERIFIED` with no transport proof under `TRANSPORT_PROOF_REQUIRED`.

This qualification checkpoint does not install the new Browser on the user machine and does not issue transport promotion/task effects.

## Authority limits

- development installer is unsigned
- artifact is unpublished
- no production promotion performed
- no live user-machine installation performed
- no Supervisor admission opened
- no Guardian/UAC/enrollment effect performed
- no task submitted to live agents
- automatic physical retry remains false
