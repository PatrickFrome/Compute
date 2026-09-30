# ADMIN.1 installed qualification checkpoint — 2026-09-30

Exact source `8c9c37c1a74f59f0d0ed72d2ec8683a2475203e3`, PR [#1085](https://github.com/PatrickFrome/Compute/pull/1085), branch `work/client-v1-admin-connectivity-v1` is qualified for installed ADMIN connectivity on the selected Meta canary. It is not a production promotion seal.

## Fixed defects

The Edge whitelist discarded the installed qualification nonce even though Native Browser sent it. A bounded metadata normalizer now preserves a valid nonce only with the exact installed-Electron run/attempt/source tuple.

Concurrent fresh `SupervisorDeviceIdentity.ensure()` calls generated separate keypairs and competed for one temporary state file. The surviving public identity did not verify the active signing key in 5/5 isolated probes. Initialization now shares one promise and publishes the signer after its encrypted identity is durable. A failed secure-storage attempt can recover.

## Evidence

- Local focused tests: 39/39 PASS. Complete Windows Browser regression: 3,745/3,745 PASS, zero skipped.
- All 20 workflows on this exact source completed SUCCESS, attempt 1.
- Installed Chat [36760350225](https://github.com/PatrickFrome/Compute/actions/runs/36760350225) proves nonce-bound OIDC approval, `ADMIN_CONNECTED`, `access_tier=ADMIN`, `POSTGREST_RPC`, automatic reconnect, and no OIDC token in Browser.
- Meta `jhriwwsryeqsvvvufkok` durable readback confirms CLAIMED, bound device, ADMIN epoch 1 and accepted signed heartbeat.
- Canary v25, source pin `9b935a3dbd2c2722c0ff72a624d98b1c3a5542de`, remains source-equivalent to this runtime-only fix. OIDC function v5 remains pinned to semantically equivalent `c8a0779...`.
- Exact tuple rollback smoke accepted the correct tuple, rejected a wrong attempt, verified removal of the weak RPC and rolled back its temporary rows. No real device was manually approved.
- Windows captures of the Chat Fleet and task-status dialog were inspected. They use deterministic fixture sessions; their Starting badge is not evidence of live connection.
- The user's own installed Windows process is not accessible from this environment. CI evidence must not be presented as a user-machine attachment.

## One-built installed artifact

Producer [36760350120](https://github.com/PatrickFrome/Compute/actions/runs/36760350120), run number 3059, attempt 1.

`METAENGINE-Browser-Test-Setup-0.7.0-dev.36755969299.1-x64.exe`

159,530,451 bytes; SHA-256 `e3918133727756f64546ad4d8bfddf4cac04243e2fe18314fad2c4c8fe23ec6f`.

[Candidate download](https://github.com/PatrickFrome/Compute/actions/runs/36760350120/artifacts/11118174462). Installed Chat, Final Runtime and Soak consume this producer. The Installed consumer terminal-success gate was verified. Package proof reports unsigned, unpublished, promotion unauthorized.

## Newly found self-update provenance gap

Self Update E2E [36760350098](https://github.com/PatrickFrome/Compute/actions/runs/36760350098) is green, but its physical harness overrides the package version and builds another target. Resident upgrade proof reports `0.7.0-dev.36760350098.1`, SHA-256 `a7e52b5102971ecfe645a3242a90621ffae07bc69c2e8c5dbe0e417d47190a65`. These bytes differ from the common producer above.

This is source-level physical update qualification, not exact-installer equality. Next development must use the existing qualified installer consumer in this full physical gate; do not weaken monotonic version, producer run/attempt/SHA or successor proof checks. Preserve this checkpoint while that change gets its own exact-head qualification.

Stable production remains v8. Its public health probe and rollback authority do not establish ADMIN behavior identical to canary. Full R83 live lease/result/rollback promotion proof remains separate from installed ADMIN qualification.

Machine-readable evidence is in `coordination/client-v1/evidence/ADMIN_1_INSTALLED_8c9c37c1_2026-09-30.json`.
