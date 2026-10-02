# One physical Package Smoke producer — terminal qualification

Qualified source: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`  
Runtime branch: `work/build-one-physical-producer-fence-v1`  
Draft PR: #1092  
Qualified package identity: `0.7.0-dev.36977000001.1`

This checkpoint is evidence-only. It does not alter the tested runtime source, live user installation, release authority, Guardian authority, or Supervisor/task admission.

## Exact-head matrix

All 10 triggered workflows are terminal SUCCESS:

- Browser Shell #3548 / run `36975915596`
- Critical Audit #2601 / run `36975915674`
- Shell-First Dirty Profile #1036 / run `36975915626`
- Host Resilience Login Start #513 / run `36975915652`
- Workspace Reincarnation #565 / run `36975915513`
- Browser Windows Package Smoke #3143 / run `36975915572`
- Installed Chat Qualification #2425 / run `36975915671`
- Final Runtime Activation #2008 / run `36975915543`
- Windows Autonomous Soak #2677 / run `36975915656`
- Self Update E2E #3596 / run `36975915484`

Browser Shell main Node suite:
- tests: **3880**
- pass: **3878**
- fail: **0**
- skipped: **2**

Additional shell contract suite:
- **102/102 PASS**

Critical Audit:
- tests: **3880**
- pass: **3880**
- fail: **0**
- skipped: **0**

## One-producer reservation

Preflight:
- schema: `metaengine.browser.package-build-reservation-preflight.v1`
- source: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`
- version: `0.7.0-dev.36977000001.1`
- producer run id: `36975915572`
- run attempt: `1`
- prior version artifact count: 0
- prior source candidate count: 0
- physical build allowed: true
- automatic retry allowed: false
- promotion authorized: false
- authority effect: false

Immutable package-version reservation:
- artifact id: `11212813280`
- name: `metaengine-browser-package-version-0.7.0-dev.36977000001.1`
- ZIP bytes: **861**
- ZIP SHA-256: `334ba15e096123c28842fbb1019dd6a1fc26676cce2ebf3c79bd512e6bd40631`

The reservation was created before dependency install and before electron-builder. This package identity is consumed and must not be rebuilt under a changed source.

## Package Smoke producer

Producer:
- run id: `36975915572`
- run number: **3143**
- run attempt: **1**
- exact source: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`

Installer:
- `METAENGINE-Browser-Test-Setup-0.7.0-dev.36977000001.1-x64.exe`
- bytes: **159811131**
- SHA-256: `31daa6c9d062e21e4e1998d2d78655aa6e81ef8224ba7f7905aa83956ac614f4`
- blockmap SHA-256: `1cd45bf005daca00192071c38751e11e66a072a554db8121ef2433b1bee909f9`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance id: `c21d9bd2-245d-435a-9ce5-1f09cf7ce89f`
- signed: false
- published: false
- promotion authorized: false

Build Identity V2:
- SHA-256: `3569734f636abe900a99f6916a02eb937aa2a775f84354d2a57eb8c3f712aec5`
- dependency-resolution SHA-256: `9affc246386338961f9f4b74f259d60304c908a28c31cc3f4510e479f8766104`
- dependency count: **55**
- Node: `v24.21.0`
- npm: `11.19.0`
- electron-builder: `26.15.7`

Immutable artifacts:
- version reservation `11212813280`, SHA-256 `334ba15e096123c28842fbb1019dd6a1fc26676cce2ebf3c79bd512e6bd40631`
- candidate `11213553858`, ZIP bytes `161278075`, SHA-256 `8c69d3fa50dfdfd1ecc6b78032375104b7929f5f3d0a362e46453dd194b896d8`
- Package Smoke evidence `11213614199`, ZIP bytes `473746`, SHA-256 `fa15c44d56354bc560719a66c5f26f1edc7a553e394a4542e54fe15ac1c53c3c`

## Package physical proof

Package Smoke proved:
- exact installed version;
- packaged Build Identity readback;
- installed ME2 UI;
- installed ME2 daemon `0.57.1`;
- normal primary ME2 shell;
- R97 DOM contract;
- second-instance activation;
- startup grace: **190 seconds**;
- same primary PID through startup grace;
- same Sentinel token through startup grace;
- parent progress advanced;
- Sentinel relaunch attempted: false;
- Guardian staging verified;
- one-shot Guardian machine bootstrap qualified.

Guardian bootstrap:
- bootstrap SHA-256: `040962a0f06c9b8fe732651d0213943571566d6c2cebb64a5311e82f0c7416d9`
- bootstrap bytes: **1283584**
- Guardian manifest SHA-256: `fc4d59894835df08972e04f710294c4a41782235d26db0ea13c2a3b96c83df2c`
- service SHA-256: `d528f50056336ba7e6491a4409a05b8f5623d634fe5327fa800bcbba24f53b5f`
- configurator SHA-256: `795688356abdc21ffaa15622a4b2fdc234e0fd6eededfee9e59b870d9178a274`
- automatic retry allowed: false
- authority effect: false

## Installed Chat

Artifact:
- id `11213877228`
- ZIP SHA-256 `913101544ad41489b03e5262427f218dc2f6d11fb44d23bb6e0d4d1b73e52e6c`

Installed Chat consumed and reverified the exact Package Smoke producer:
- installer SHA matched `31daa6c9…614f4`
- Build Identity matched `3569734f…2aec5`
- dependency-resolution matched `9affc246…66104`
- clean genesis: true
- normal shell: `ME2_PRIMARY`
- OIDC enrollment qualification: true
- OIDC token exposed to Browser: false
- ADMIN connection: true
- ADMIN access tier: `ADMIN`
- automatic initial remote load suppressed.

## Final Runtime

Artifact:
- id `11213264155`
- ZIP SHA-256 `115372e077defdcb92da20ac9629e720b42d08952eaf5c11f5c5b820056418de`

Runtime:
- lifecycle: `READY`
- Host Agent: `READY`
- signer: `READY`
- host runtime: `READY`
- transport active: true
- typed Browser IPC: true
- verified execution outcomes: true
- second scheduler: false
- automatic effect retry: false
- authority effect: false
- host identity: `WAITING_FOR_ENROLLMENT`

The host identity status is preserved as an open boundary; it is not rewritten as success.

## Autonomous Soak

Artifact:
- id `11213717889`
- ZIP SHA-256 `e03a7fb5801316b5a85a96aafa8063155f460caa7df10975f06c9c88d8982c87`

Installed Browser:
- 72/72 second-instance activations
- 64 sequential + 8 concurrent
- activation p95: **313.89 ms**
- budget: 1000 ms
- concurrent burst elapsed: **423.02 ms**
- working-set growth: **0**
- handle growth: **+12 / +24 budget**
- duplicate Browser runtime: false
- redundant durable second-instance markers: 0

Brain:
- 1,000,000 semantic edges
- 128 BrowserCells
- 128 agents
- **94,762 semantic edges/s**
- 32 peak parallel mutation lanes
- bounded cell facts: 2048
- second scheduler: false
- automatic effect retry: false

Continuous 100k, 2000 tasks / 2048 peers, and all configured chaos seeds passed.

## Self Update E2E

Artifact:
- id `11213009590`
- ZIP bytes: `160909923`
- ZIP SHA-256: `ec64849202802da7d3942d94a07dc99e9f91bc8d4f7389fa60c90cffe12d8ac0`

Verifier fixture:
- installer tampering rejected
- attempt drift rejected
- binding digest drift rejected
- dependency proof tampering rejected
- handled native exit state cleared: true
- installer executed during negative fixture: false

Fast update:
- baseline: `0.7.0-dev.36806234662.1`
- target: `0.7.0-dev.36977000001.1`
- exact source: `8409fb249887dd4636b3bd6fab40bfe30fa4b085`
- result: `FAST_SELF_UPDATE_PASS`

Resident Browser + Sentinel update:
- legacy version: `0.7.0-dev.34759310781.1`
- legacy Browser gone: true
- legacy Sentinel gone: true
- target installer SHA-256: `31daa6c9d062e21e4e1998d2d78655aa6e81ef8224ba7f7905aa83956ac614f4`
- expected installed executable SHA-256: `42147d3373bd75b4a56b3278dac9413bb3625ead5e819f7578e6a6506d4dc716`
- installed executable SHA-256: exact match
- new Browser started: true
- new Sentinel started: true
- planned shutdown verified: true
- retry dialog required: false
- authority effect: false

## Qualification conclusion

The producer-side collision fence is now physically proven on one exact source and one exact package identity:

1. rerun attempt must equal one;
2. package-version job concurrency does not cancel an existing producer;
3. exact version/source artifact history is checked before physical build;
4. API ambiguity fails closed;
5. immutable package-version reservation exists before dependency install;
6. reservation proof rides with candidate/evidence;
7. exactly one Package Smoke installer artifact fed every physical consumer;
8. all physical consumers reverified the same producer run/attempt, Build Identity and dependency digest.

No second physical producer was created for the qualified version.

## Live user Browser remains separate

Latest observed user Browser remains `0.7.0-dev.36908273822.1`, with Compute HEALTHY, Development Plane READY, Host Resilience ACTIVE, and four `BOUND_UNVERIFIED` fleet agents under `TRANSPORT_PROOF_REQUIRED`.

This checkpoint does not install the qualified package on the user machine.

## Next development slice already started

Separate branch:
`work/build-lockfile-material-v1`

Current work there:
- package-lock material verifier;
- exact byte SHA-256;
- package/root identity validation;
- direct dependency spec validation;
- optional/platform material observation;
- Windows-safe npm version probe;
- unit tests;
- syntax gate integration.

Separate research:
`analysis/npm-ci-lockfile-rollout-v1`

The next target is frozen dependency input:
- generate committed Browser package-lock under Node 24/npm 11;
- prove two clean `npm ci` installs;
- bind package-lock SHA to Build Identity successor;
- retain installed dependency-resolution SHA independently;
- converge physical workflows to `npm ci`.

No release, live installation, or promotion is authorized by this checkpoint.
