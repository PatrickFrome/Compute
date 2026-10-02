# Build Identity V2 partial qualification checkpoint — 2026-10-02

Qualified source under observation: `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c`  
Runtime branch: `work/build-identity-v2-v1`  
Draft PR: #1091  
Evidence branch: `analysis/build-identity-v2-partial-2a0022d`

This is evidence-only. It does not alter the tested runtime source, release authority, live Browser installation, Guardian authority, or Supervisor admission.

## Exact-head workflow result

At this checkpoint, 9/10 triggered exact-head workflows are terminal SUCCESS and Self Update E2E is the only failure:

- Host Resilience Login Start #511 — SUCCESS
- Workspace Reincarnation #563 — SUCCESS
- Browser Shell #3546 — SUCCESS
- Critical Audit #2599 — SUCCESS
- Shell-First Dirty Profile #1034 — SUCCESS
- Package Smoke #3137 — SUCCESS
- Installed Chat #2423 — SUCCESS
- Final Runtime Activation #2006 — SUCCESS
- Autonomous Soak #2675 — SUCCESS
- Self Update E2E #3594 — FAILURE

The Self Update contract job itself passed. Its Windows physical job failed before candidate acquisition/self-update because the new negative-test fixture left a non-zero native `$LASTEXITCODE` after an expected refusal even though the PowerShell test printed its final success JSON.

## One-built Package Smoke evidence

Producer:
- run id: `36971539452`
- run number: `3137`
- attempt: `1`
- exact source: `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c`

Package:
- version: `0.7.0-dev.36973000001.1`
- installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36973000001.1-x64.exe`
- bytes: **159811161**
- installer SHA-256: `28c3199c1accb761a412bca2eecfcb3e323fe74baa63fda263d7d8de0dd9893d`
- blockmap SHA-256: `cd9bd768e3cae62fc6870b9a9fa44e0caf8e3093d1a0091a3ef725493661f395`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance id: `dc05f2b6-cab2-4da2-8781-24bbd4bcc500`

Build Identity V2:
- schema: `metaengine.browser.build-identity.v2`
- build identity SHA-256: `2e8c125f036ee27566a5857ab5c94fe65c2d400cf7ba0af1204fee4c79ae1ee1`
- dependency resolution SHA-256: `e37879804789c4354b0c732f2ac7a05fdfb70bf5c82a3c6849d79265200dc7f5`
- resolved dependency count: **55**
- Node: `v24.21.0`
- npm: `11.19.0`
- electron-builder: `26.15.7`
- authority effect: false

Candidate artifact:
- id: `11211928176`
- ZIP SHA-256: `1a59ead187faa585085310fc4ff2f1fc4fa6bc812e409850ebe1bf4022c12e31`
- ZIP bytes: `161276531`

Package evidence artifact:
- id: `11212390898`
- ZIP SHA-256: `bccd8773f37fc76de93f918dd116df93093078571c35cda2dd57f6bbf6f72822`
- ZIP bytes: `472773`

Package physical evidence:
- installed version probe: PASS
- normal primary ME2 UI boot: PASS
- R97 DOM contract: PASS
- second-instance activation: PASS
- startup grace survival: **190 seconds**
- same primary PID across startup grace: true
- same Sentinel token across startup grace: true
- parent progress advanced: true
- Sentinel relaunch attempted: false
- Guardian native staging: PASS
- packaged Build Identity readback from app.asar: PASS
- expected pre-build identity == beforePack identity == packaged readback: PASS

## Downstream physical consumers

Installed Chat #2423 consumed and reverified the same Package Smoke artifact:
- artifact id: `11211704448`
- artifact ZIP SHA-256: `9743ff1f465d85f6055c0083001d67083e81ae0caed2b305f925bd71c49cd956`
- producer terminal gate carried the exact Build Identity and dependency digest.

Final Runtime #2006 consumed and reverified the same artifact:
- artifact id: `11212057896`
- artifact ZIP SHA-256: `f66a0009acfb5d1f13f75af6a9d8f46c9d02bac7148684094da50a15bdbf845a`
- final runtime state: READY
- Host Agent: READY
- signer: READY
- typed Browser IPC: true
- verified execution outcomes: true
- second scheduler: false
- automatic effect retry: false

Autonomous Soak #2675:
- artifact id: `11211463363`
- artifact ZIP SHA-256: `b9d921f262f7b08d15ecd7688a1f614137ca7b9b9d24702927a691608be5d6d3`
- 72/72 second-instance activations
- activation p95: **153.01 ms** / 1000 ms budget
- concurrent burst: 8 in **499.64 ms**
- working-set growth: **0**
- handle growth: **+14** / +24 budget
- duplicate Browser runtime: false
- redundant durable second-instance markers: 0

Brain endurance:
- 1,000,000 semantic edges
- 128 BrowserCells
- 128 agents
- **93,463 semantic edges/s**
- 32 peak parallel mutation lanes
- bounded cell facts: 2048
- second scheduler: false
- automatic effect retry: false

Scale/continuous/chaos jobs all passed:
- 100k continuous Brain
- 2,000 tasks / 2,048 peers
- all configured chaos seeds.

## Self Update #3594 failure classification

Self Update workflow run: `36971539420`

Contract job: SUCCESS.

Windows physical job `110726803976` failed in the pre-physical test step:
`./test/qualified-installer-consumer-verify.ps1`

The fixture intentionally exercised expected refusal paths:
- installer size mismatch;
- producer attempt mismatch;
- binding digest drift;
- dependency proof tampering.

All refusals were correctly observed and the script printed:
`metaengine.browser.qualified-consumer-verify-smoke.v1` with every expected rejection flag true.

However the last expected negative path invokes native Node code that exits non-zero. PowerShell catches the expected refusal, but `$LASTEXITCODE` remains non-zero because calling a script directly does not automatically reset it after that script/native command returns. The workflow wrapper therefore exits 1 despite the semantic test succeeding.

Microsoft PowerShell documentation confirms that `$LASTEXITCODE` stores the exit code of the last native program or script, and directly invoked scripts do not reset it unless another native/script exit replaces it:
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_error_handling

This is a test-harness exit-state defect, not a failure of the qualified installer, provenance verification, updater transaction, or physical Self Update logic. The Windows Self Update job never reached candidate acquisition, installer execution, or update effect.

## Consequence

Because Package Smoke physically produced installer bytes for `0.7.0-dev.36973000001.1`, that package identity is consumed. Any source fix, even test-only, must use a new package identity before the next physical build.

Promotion remains blocked because Self Update is not terminal green on this exact head.

## Next safe successor

1. Fix the expected-refusal fixture so a handled negative native result cannot leak stale `$LASTEXITCODE` into the workflow process result.
2. Add an explicit regression assertion for the fixture process exit.
3. Advance package identity atomically.
4. Re-run the exact-head matrix on a new source SHA.
5. Require one new Package Smoke producer artifact and all physical consumers, including Self Update, to pass on that exact identity.
