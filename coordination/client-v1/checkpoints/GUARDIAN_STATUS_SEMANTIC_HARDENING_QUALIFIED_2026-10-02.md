# Guardian status semantic hardening qualification — 2026-10-02

Qualified runtime source: `bf21d71b6dc674c376bd396487b5efc134d0a3e9`  
Runtime branch: `work/guardian-status-semantic-hardening-v1`  
Runtime PR: #1090  
Evidence branch: `analysis/guardian-status-hardening-qualified-bf21d71`

This checkpoint is evidence-only. It does not mutate the tested runtime source, live user machine, production admission, or updater authority.

## Exact-head result

All **10/10 workflows triggered for this stacked slice are terminal SUCCESS**:

- Browser Shell V1 #3543
- Critical Audit #2596
- Shell-First Dirty Profile #1031
- Host Resilience Login Start #508
- Workspace Reincarnation #560
- Windows Package Smoke #3127
- Windows Installed Chat Qualification #2420
- Final Runtime Activation #2003
- Windows Autonomous Soak #2672
- Self Update E2E #3591

Browser Shell contract:
- tests: **3859**
- pass: **3857**
- fail: **0**
- skipped: **2**

Critical Audit full Browser suite:
- tests: **3859**
- pass: **3859**
- fail: **0**
- skipped: **0**

The new Guardian semantic regression is explicitly present:
`hung, malformed, or false-positive Guardian observations cannot become positive` — PASS.

## Qualified one-built installer

Producer:
- workflow run id: `36966356240`
- run number: `3127`
- attempt: `1`
- exact source: `bf21d71b6dc674c376bd396487b5efc134d0a3e9`

Package:
- version: `0.7.0-dev.36965253139.1`
- installer: `METAENGINE-Browser-Test-Setup-0.7.0-dev.36965253139.1-x64.exe`
- installer bytes: **159810808**
- installer SHA-256: `d59ca94853ac7f7749d84a526849f369137ca34698e7987a5f7fd6a03d79262a`
- blockmap SHA-256: `036ec3714b50bfc3321f1a89ee6431dbdd0b69da29eb4067afdb148ce2b8d884`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance id: `f50ef06d-ee09-4f20-9fe7-86ce7fe933cf`
- signed: false
- published: false
- promotion authorized: false

Candidate artifact:
- id: `11209524202`
- archive bytes: `161265099`
- archive SHA-256: `98a7ab28d5faeb1e5e15447813358e3e2642909d4efc8177db06f62819341435`

Package evidence artifact:
- id: `11210347430`
- archive bytes: `469385`
- archive SHA-256: `d30cbc867898bed9f50b080bf00c2dbe94ca442006c944a5cf2a53aa237ecb8b`

Package Smoke also proved:
- normal primary ME2 shell visible;
- R97 DOM contract;
- second-instance activation;
- startup grace survival **190 seconds**;
- same primary PID across startup grace;
- same Sentinel token across startup grace;
- parent progress advanced;
- no Sentinel relaunch;
- Guardian native staging verified;
- Guardian machine bootstrap physical qualification passed.

## Guardian semantic hardening that is now physically qualified

Current stale/invalidated diagnostic proof is fail-closed:
- stale READY -> HOLD;
- current `guardian_service_ready=false`;
- current `owner_binding_proven=false`;
- current `device_binding_proven=false`;
- previous positive proof survives only in explicit `last_confirmed_*` historical fields.

Activation invalidation now clears the current cached proof and publishes the invalidation HOLD while an older generation remains unable to overwrite the post-activation state.

Observer validation now rejects:
- unknown states;
- inconsistent ready/explicit-action/UAC flags;
- READY without service + owner + device proof;
- positive owner/device proof on any non-READY state;
- malformed OWNER_ENROLLMENT_REQUIRED proof;
- malformed ACTIVATION_REQUIRED proof;
- any deviation from fixed packaged bootstrap / no caller path / no arbitrary shell / no auto retry / zero authority.

This remains diagnostic-only. No Supervisor admission, scheduler, task lease, UAC, enrollment, release, or automatic physical retry authority is added.

## Autonomous soak

The soak acquired the exact Package Smoke producer artifact and verified it instead of rebuilding.

Installed Browser activation:
- second-instance activations: **72/72**
- sequential activations: 64
- concurrent burst: 8
- activation p95: **643.57 ms**
- budget: 1000 ms
- working-set growth: **0**
- handle growth: **+9**
- handle budget: +24
- duplicate Browser runtime: false
- redundant durable second-instance markers: 0

Brain/fleet:
- 1,000,000 semantic edges
- 128 BrowserCells
- 128 agents
- **127,357 semantic edges/s**
- 32 peak mutation lanes
- bounded cell facts: 2048
- 100k continuous Brain: PASS
- 2,000 tasks / 2,048 peers: PASS
- all configured chaos seeds: PASS

Soak evidence artifact:
- id: `11210072991`
- archive SHA-256: `5fb57670b162e719d5eee09771d122363defc0c2215d480ae14a4c13de4a3858`

## Self Update E2E

Self Update acquired the exact Package Smoke artifact.

Fast physical update:
- baseline: `0.7.0-dev.36806234662.1`
- target: `0.7.0-dev.36965253139.1`
- exact source: `bf21d71b…`
- result: `FAST_SELF_UPDATE_PASS`

Resident Browser + Sentinel upgrade:
- legacy version: `0.7.0-dev.34759310781.1`
- resident installer exit: 0
- legacy Browser gone: true
- legacy Sentinel gone: true
- target installer SHA-256: `d59ca94853ac7f7749d84a526849f369137ca34698e7987a5f7fd6a03d79262a`
- expected installed executable SHA-256: `e3b2e0c306170e0ab6da2d1ec5defc314d0e63f330348d9b7b25e38505878a32`
- installed executable SHA-256: same
- new Browser started: true
- new Sentinel started: true
- planned shutdown verified: true
- retry dialog required: false

Self-update evidence artifact:
- id: `11209687376`
- archive SHA-256: `4814bd8916bb685130036d5772cdbe12e19c1bc4f0cf7e8c9838d0fc03349595`

Other physical consumers:
- Installed Chat artifact `11210640107`, SHA-256 `933448765ad6d3eaaf2ecc635e7e90e09432e91acf1187435c3804c3ae234ffa`
- Final Runtime artifact `11210167789`, SHA-256 `987c20eb31e6a84548760e0fe6eeb3a506096bc4afbe52b40e047aedf149400e`

## Next engineering boundary

The Guardian heartbeat/semantic slice is now qualified. The next independent successor should address build identity/provenance without creating a parallel control plane.

Existing research already concluded that the right path is to evolve:
- `scripts/installer-provenance.mjs`
- the current before-pack metadata hook
- the current after-artifact readback hook
- Package Smoke's existing one-builder/one-artifact producer

Target next slice:
- deterministic `build_identity_sha256`;
- source/run-attempt/config/dependency-resolution binding;
- semantic-version/source collision rejection;
- no rebuild in downstream consumers;
- preserve installer hash as post-build artifact subject rather than circular build input.

No live installation or admission change is part of that successor.
