# ADMIN.1 and shared installer qualification — 2026-09-30

Exact source `93c64424525e00444a97abc151ef05bd386da3d7`, PR [#1085](https://github.com/PatrickFrome/Compute/pull/1085), branch `work/client-v1-admin-connectivity-v1`.

This checkpoint closes installed ADMIN connectivity and the full Self Update E2E artifact mismatch. It does not seal production promotion or attach the user's personal Windows process.

## Changes and regression causes

- Edge enrollment metadata now preserves a valid installed qualification nonce with exact run/attempt/source correlation.
- Concurrent first startup now shares one durable device identity initialization; public key and signer stay paired across parallel consumers and reload.
- Full Self Update E2E now consumes the same immutable Package Smoke installer as Installed Chat, Final Runtime and Soak. Verify re-hashes installer/blockmap/config and producer identity through the existing helper. A required missing binding or non-monotonic target fails closed. The full consumer does not rebuild the target or edit tracked source.

The first two fixes were physically qualified at `8c9c37c1...` and archived separately at [the earlier checkpoint](https://github.com/PatrickFrome/Compute/blob/analysis/client-v1-admin-installed-qualified-v1/coordination/client-v1/checkpoints/ADMIN_1_INSTALLED_QUALIFIED_2026-09-30.md). Its green self-update job used another installer; the current checkpoint repairs that exact gap.

## One installer

`METAENGINE-Browser-Test-Setup-0.7.0-dev.36760350225.1-x64.exe`

- Bytes: **159,530,378**.
- SHA-256: `2a608411c15673ac4f9af9c0504074ed8cb82f04afc2ac3f0a861023eb73f4bb`.
- Producer: [36765836910](https://github.com/PatrickFrome/Compute/actions/runs/36765836910), run number **3060**, attempt **1**.
- [Download candidate ZIP](https://github.com/PatrickFrome/Compute/actions/runs/36765836910/artifacts/11120334332).
- Package proof remains unsigned, unpublished and promotion unauthorized.

The producer provenance, Installed Chat proof and resident-upgrade proof all carry this same version and installer digest. Both Installed Chat and Self Update record terminal success of this exact producer.

## Terminal evidence

All **20/20 workflows** on this SHA finished SUCCESS, attempt 1. Complete Windows Browser regression: **3,746/3,746 PASS**, zero failed or skipped. Local provenance/topology regressions: **44/44 PASS**, zero skipped.

Installed [36765836702](https://github.com/PatrickFrome/Compute/actions/runs/36765836702) proves OIDC nonce-bound approval, `ADMIN_CONNECTED`, ADMIN epoch 1, POSTGREST_RPC, automatic reconnect and no OIDC token exposed to Browser. Selected Meta `jhriwwsryeqsvvvufkok` durable readback confirms CLAIMED, bound ADMIN device and accepted signed heartbeat.

Full Self Update [36765836906](https://github.com/PatrickFrome/Compute/actions/runs/36765836906) passes physical N→N+1 with a local test feed, durable successor/profile/singleton checks and zero consumer target builds. Its real resident upgrade from `0.7.0-dev.34759310781.1` starts the new primary and Sentinel without Retry/Ignore UI. The read-only Windows Verify smoke accepts valid binding and rejects installer/attempt/binding-digest tampering; fixture bytes are never executed.

Self-update manifest predicates are recorded as assertions of the exact successful workflow. The raw large artifact manifest was not materialized locally; resident digest and terminal producer gate were read directly from job logs. The small Package Smoke evidence archive was downloaded and its full ZIP hash verified.

Installed UI is **38,779,621 bytes**, embedded daemon **0.57.1**; normal UI boot, second-instance activation and one primary/Sentinel across the 190-second startup grace pass.

## Backend and remaining boundary

Canary v25, pin `9b935a3dbd2c2722c0ff72a624d98b1c3a5542de`, remains source-equivalent to this candidate. OIDC function v5 remains active. Stable production is still v8; the ordinary installer default points to stable while Installed ADMIN uses an explicit canary endpoint. Do not infer ordinary user-machine ADMIN connection from this CI result.

Full R83 live lease/result/rollback promotion evidence and authenticated z.ai Agent-origin accepted-result closure remain separate gates. Keep the qualified source and installer immutable. Record future live evidence externally rather than editing this source manifest after qualification.

Machine evidence: `coordination/client-v1/evidence/ADMIN_1_SHARED_INSTALLER_93c64424_2026-09-30.json`.
