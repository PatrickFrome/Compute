# Build Identity V3 first physical attempt evidence — 2026-10-02

Evidence branch: `analysis/build-identity-v3-physical-attempt-245920c`  
Failed physical source: `245920c1a45851a1d30c25341ce2ca33457bc5c7`  
Closed draft PR: #1093  
Consumed package: `0.7.0-dev.36980000001.1`  
Successor source: `d283150bc8a3338a76b98c369b67fb7e846b207b`  
Successor reserved package: `0.7.0-dev.36990000001.1`

This checkpoint is evidence-only. It does not alter the failed source, successor runtime source, live installation, release authority, Guardian authority, or Supervisor/task admission.

## Exact physical matrix on 245920c

8/10 exact-head workflows were terminal SUCCESS:

- Host Resilience Login Start #514 — SUCCESS
- Workspace Reincarnation #566 — SUCCESS
- Browser Shell #3549 — SUCCESS
- Critical Audit #2602 — SUCCESS
- Shell-First Dirty Profile #1037 — SUCCESS
- Package Smoke #3144 — SUCCESS
- Final Runtime Activation #2009 — SUCCESS
- Autonomous Soak #2678 — SUCCESS

Two workflows failed:
- Self Update #3597 — FAILURE before installer acquisition/effect
- Installed Chat #2426 — FAILURE after installer acquisition during OIDC qualification

## Package Smoke #3144

Producer:
- run id: `36988305577`
- run number: `3144`
- attempt: `1`

Version reservation artifact:
- id: `11218079311`
- SHA-256: `8c9bea4e65699be2e54fa6053985224dc50db68fd8c187783df0620c2cc72d0b`
- bytes: 861

Candidate artifact:
- id: `11219075285`
- SHA-256: `0bd562397864a8d2be5b6929b2051d27545271b35219fdd65ce7700a5df1969b`
- bytes: 158406516

Package evidence artifact:
- id: `11218329600`
- SHA-256: `3695822543bf9a85280308c2d2118ab20950f4c6385ae93f6b44a211f74e70ca`
- bytes: 622590

Installer:
- `METAENGINE-Browser-Test-Setup-0.7.0-dev.36980000001.1-x64.exe`
- installer SHA-256: `95b13e17777c9ca9dd70f8d7ad0d2ae493960631e85e63cf6d07de0d1e2cffa3`
- installer bytes: 156364343
- blockmap SHA-256: `8cc5fafbd328945c58ec930b17d186c48950b88c8fa8cdbd9b66fa8dce530c9c`
- builder config SHA-256: `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`
- provenance id: `fedd3deb-fa1e-44be-ad19-9ae3885c6a6a`
- provenance schema: `metaengine.browser.installer-provenance.v3`
- signed: false
- published: false

Build Identity V3:
- SHA-256: `fada9ffb64f5863062edbce54090e32d30e87f61dfd113c791477130cc6df128`
- dependency-resolution SHA-256: `1e68dcc723bdf3aabb5af6bcc3e3a7e31cc03a9e8c8523498069350b0054e8cf`
- package-lock SHA-256: `0e90ce9b7928debfbbda537104411fb4d8d98dfb0e21e1816335a4460ad73be3`
- dependency count: 501
- Node: `v24.21.0`
- npm: `11.19.0`
- electron-builder: `26.15.7`
- Bun: `1.3.3`
- ME2 UI bun.lock SHA-256: `a81d5c2c173747ba19a5461f16485895fabb7aa5f740b95645cb01891547ba81`
- authority effect: false

Package Smoke physical proof:
- normal UI boot verified
- installed ME2 UI verified
- ME2 daemon version 0.57.1 verified
- second-instance activation verified
- startup grace: 190 seconds
- same primary PID across startup grace
- same Sentinel token across startup grace
- parent progress advanced
- Sentinel relaunch attempted: false
- Guardian staging verified
- one-shot Guardian bootstrap qualification completed

## Downstream successes

Final Runtime #2009:
- artifact id `11218299915`
- ZIP SHA-256 `c5e70e0bb280214f1eda9f7ff2d0cb1a79428206c433829498e283504dd500b8`
- terminal SUCCESS

Autonomous Soak #2678:
- artifact id `11219205604`
- ZIP SHA-256 `96e74d72ac7fcc628ad8bf845f2ee2f23f95f41e2f52ead1461ba1276d23cb94`
- continuous Brain, 1M/128/128, scale/chaos and installed activation soak all terminal SUCCESS

## Self Update #3597 root cause

The Self Update contract job passed.

Windows physical job failed before installer acquisition/effect inside the backward-compatibility fixture:
`test/qualified-installer-consumer-verify.ps1`

Exact failure:
`package_lock_sha256` missing under PowerShell StrictMode for a historical V2 binding.

This is a real source compatibility defect introduced by the V3 consumer projection. V2 bindings are valid without V3-only lock/npm/Bun/UI-lock properties.

No updater or installer effect started.

Successor correction at `d283150b…`:
- accepts V2 and V3;
- dereferences V3-only fields only for provenance schema V3;
- terminal producer projection emits V3 fields only for V3;
- adds the behavioral V2 compatibility fixture to Windows source qualification.

## Installed Chat #2426 classification

Installed Chat successfully:
- acquired the exact Package Smoke candidate;
- reverified installer provenance V3;
- verified Build Identity, dependency tree, package-lock, Bun and UI lock;
- installed the Browser;
- verified installed ME2 UI and ME2 daemon.

It then failed at the OIDC qualification request with HTTP 403.

Timeline matters:
- PR #1093 was closed at 09:16:17 UTC after the Self Update source defect was identified.
- Installed Chat acquired the candidate at approximately 09:17 UTC.
- OIDC qualification returned 403 at approximately 09:18 UTC.

Therefore this 403 is preserved as an **environment/PR-lifecycle failure after the draft was intentionally closed**, not used as evidence of a Browser package defect.

A successor physical run must keep its draft PR open through terminal consumer qualification.

## Consequence

`0.7.0-dev.36980000001.1` is permanently consumed.

Do not rerun it.

The successor `0.7.0-dev.36990000001.1` may start physical qualification only after exact source-only qualification on `d283150b…` is terminal SUCCESS.

No promotion, release, live install, Guardian enrollment, Supervisor admission or live task effect is authorized.
