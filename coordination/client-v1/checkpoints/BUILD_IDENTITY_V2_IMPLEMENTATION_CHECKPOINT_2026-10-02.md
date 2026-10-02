# Build Identity V2 implementation checkpoint — 2026-10-02

Implementation source before checkpoint: `d8e17c51155d67d54d778afa4fb79893a47a9360`  
Branch: `work/build-identity-v2-v1`  
Stacked base: `bf21d71b6dc674c376bd396487b5efc134d0a3e9` / PR #1090

No pull request exists for this branch at checkpoint time, so no Package Smoke physical build has been triggered and the inherited package version has not been consumed by this branch.

## Implemented

Build Identity V2:
- deterministic canonical `metaengine.browser.build-identity.v2`;
- exact repository + repository id;
- exact source SHA;
- Package Smoke workflow;
- GitHub run id + run attempt;
- package version;
- platform/arch;
- builder-config SHA-256;
- installed dependency-resolution SHA-256;
- electron-builder version;
- Node version;
- zero authority.

Dependency resolution:
- actual installed npm name/version tree is canonicalized;
- Node/npm versions included;
- proof schema `metaengine.browser.dependency-resolution.v1`;
- proof is tamper-evident;
- explicitly not claimed to freeze package bytes.

Packaging:
- independent expected identity computed before packaging;
- before-pack recomputes and injects `metaengineBuildIdentity`;
- after-all-artifact hook reads app.asar and verifies packaged identity;
- mismatched expected/before-pack/packaged identity fails closed.

Installer provenance:
- v1 remains readable for historical compatibility;
- Package Smoke now emits `metaengine.browser.installer-provenance.v2`;
- v2 binds build identity + dependency resolution to source/run/attempt/version/config/installer/blockmap;
- downstream consumers require v2 and reverify external identity/dependency proof before physical use;
- terminal producer proof carries Build Identity and dependency digest.

Tests:
- deterministic invocation identity;
- source/run/rerun/config/dependency drift;
- malformed digest/binding rejection;
- dependency proof tampering;
- installer provenance v2 write/verify roundtrip;
- external identity tamper;
- dependency-resolution tamper;
- qualified installer consumer v2 fixture;
- static Package Smoke / before-pack / after-artifact / consumer wiring.

## Editing incident closed before CI

During early workflow/PowerShell edits, JavaScript replacement text containing a regex end anchor followed by a quote (`$'`) was interpreted by `String.replace` as a special replacement token. That duplicated file suffixes.

Evidence that caught it:
- Package Smoke workflow expanded from ~698 to ~2476 lines;
- same build/upload blocks appeared 3-4 times;
- qualified installer consumer expanded from ~211 to ~987 lines.

Repair:
- reconstructed both files from exact qualified base `bf21d71…`;
- applied intended modifications with literal callback replacement;
- committed full-file Git tree replacement in `43b46af227c9943099f94572ea1cd3745bffa8cb`.

Post-repair:
- Package Smoke build step count = 1;
- candidate upload count = 1;
- evidence upload count = 1;
- consumer Acquire block = 1;
- consumer Verify block = 1;
- consumer binding block = 1.

GitHub did create seven push workflow records while the YAML was malformed: Package Smoke #3128-#3134 (run ids 36968517070, 36968531131, 36968549520, 36968565590, 36968618998, 36968649385, 36968682903). All seven completed FAILURE with **zero jobs and zero artifacts**. Therefore no runner reached dependency install, packaging, installer creation or artifact upload, and no physical package identity was consumed by those malformed heads. After the exact full-file repair, later pushes produced no Package Smoke run because the valid workflow push filter does not include this branch.

## Current source changes vs qualified base

Expected files only:
- `.github/workflows/browser-windows-package-smoke.yml`
- `apps/metaengine-browser/package.json` (check script only; version not yet advanced)
- `scripts/build-identity.cjs`
- `scripts/build-identity-cli.mjs`
- `scripts/dependency-resolution-digest.mjs`
- `scripts/electron-builder-before-pack.cjs`
- `scripts/electron-builder-after-all-artifact-build.cjs`
- `scripts/installer-provenance.mjs`
- `scripts/qualified-installer-consumer.ps1`
- `test/build-identity.test.mjs`
- `test/installer-provenance-v2.test.mjs`
- `test/qualified-installer-consumer-verify.ps1`
- research/checkpoint documents.

## Research decisions

Primary sources:
- GitHub Actions variable reference for repository/run/attempt identity;
- electron-builder v26 hooks and extraMetadata;
- SLSA provenance buildDefinition/runDetails separation;
- npm package-lock + npm ci frozen-install semantics;
- actions/upload-artifact immutable v4 artifacts and artifact digests;
- GitHub artifact attestations.

Adopted now:
- deterministic invocation identity;
- source-scoped immutable candidate remains the single physical carrier;
- dependency-resolution evidence from actual install;
- v2 provenance verification in all physical consumers.

Deferred:
- committed Browser lockfile + npm ci;
- dependency integrity/byte-level reproducibility;
- GitHub artifact attestation at release boundary;
- any automatic semantic-version allocator.

## Remaining pre-PR gates

Completed before this reservation:
1. Final source/diff audit: expected bounded file set; no duplicated workflow/consumer blocks.
2. Downstream audit: physical workflows use the central qualified-installer consumer and contain no v1-only provenance requirement.
3. Re-read latest repository workflow id: `36968682903`.
4. Frozen implementation source before reservation: `5a75a4129e305752b868f1d0604319e9b30122e1`.

Final reservation in this commit:
- package identity: `0.7.0-dev.36970010001.1`;
- no further runtime/source commit is allowed before qualification without retiring this identity.

Remaining:
1. Open stacked draft PR against `work/guardian-status-semantic-hardening-v1`.
2. Once its exact Package Smoke runner starts, conservatively treat `0.7.0-dev.36970010001.1` as consumed.
3. Require exact-head Browser tests, Package Smoke, Installed Chat, Runtime, Soak and Self Update to all pass on one producer artifact.
4. If source changes after physical build begins, advance package identity; never relabel bytes.

## Future hardening boundary

The current dependency digest proves which name/version tree npm actually installed. It does not include registry tarball integrity. Before making reproducibility claims, add a reviewed lockfile with integrity data and use `npm ci`.

GitHub attestations should be added only at release-candidate/published-release boundary, not used as a substitute for physical Windows qualification or installer SHA-256.

Promotion authority remains false.


## Final freeze and reservation

Pre-reservation implementation source: `5a75a4129e305752b868f1d0604319e9b30122e1`.

The final source reservation is `0.7.0-dev.36970010001.1`. This value is intentionally above the latest observed repository workflow id at freeze time and does not reuse the fixture identity `0.7.0-dev.36970000001.1` used only inside tests.

Final audit invariants:
- Package Smoke build step count: 1;
- candidate artifact upload count: 1;
- qualification evidence upload count: 1;
- qualified consumer Acquire block count: 1;
- qualified consumer Verify block count: 1;
- qualified consumer binding block count: 1;
- v1 provenance remains read-compatible for historical evidence, but new physical consumers require v2;
- zero authority/release/admission effect.

Do not add another runtime/source commit to this branch before the first exact-head qualification outcome. Research or qualification evidence after that point belongs on a separate analysis branch.


## First PR qualification attempt — dependency resolver pre-build failure

PR #1091 opened at exact head `04fce17d3b6de1b8a5399962887bad8070d2b740` with `0.7.0-dev.36970010001.1`.

Package Smoke:
- run id: `36970396272`
- run number: `3135`
- job: `110722962017`
- failed step: **Capture exact installed dependency resolution**
- completed before failure: checkout, exact-head proof, Node setup, Browser npm install
- skipped after failure: expected Build Identity, source parse, visual evidence, UI staging, NSIS package build, candidate upload, install/physical package tests
- candidate installer artifact: **none**

Observed diagnostic:
`dependency_resolution_npm_ls_failed:null`

Root cause:
- on the Windows Node 24 runner, direct `spawnSync('npm.cmd', ...)` did not create a child process and returned a null status;
- the previous code checked only `status !== 0`, so the diagnostic hid the underlying spawn-layer distinction.

Repair in the next exact source:
- add a pure `npmInvocation()` contract;
- Windows uses `ComSpec /d /s /c npm.cmd ...` so the OS command processor resolves the npm command shim;
- Linux/macOS keep direct `npm` execution;
- explicit `result.error` becomes `dependency_resolution_npm_spawn_failed:<code>`;
- add a cross-platform unit contract proving the invocation geometry.

Identity discipline:
- `0.7.0-dev.36970010001.1` is retired conservatively because Package Smoke runner #3135 started, even though packaging never began and no candidate artifact exists;
- corrected identity: `0.7.0-dev.36972000001.1`;
- any further runtime/source correction after the new Package Smoke starts must advance again.

The failure is pre-effect for installer bytes. No blind rerun was issued; source is corrected and will receive a new exact-head qualification.
