# METAENGINE Browser Self-Update Live Test V1

Status: IN_PROGRESS
Authority effect: false
Production/main mutation: none

## Source / installed baseline

- Live client_id: `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9`
- Installed baseline: `0.6.3-dev.64.1`
- Baseline source: `b1701f8a32196962b190ac240c76045e4eaa38ea`
- In-place continuity: PASS (same client_id after manual bootstrap)
- Supervisor mode after bootstrap: CONTROL
- Armed after bootstrap: true

## Verified N+1

- Candidate source: `3d90adae9b658971f005f2a5abb563112441ac47`
- Browser Shell run: `33270647860` PASS
- Physical Self Update E2E run: `33270647883` PASS
- Artifact: `9720041364`
- Target version: `0.6.3-dev.65.1`
- Installer SHA-256: `94724d5cea1ff3671d4f874901c3d6b7ffd1e601204064aad333a974b6f0b53a`
- Physical N→N+1: PASS
- Durable successor binding: PASS
- Profile continuity: PASS
- Single install directory: PASS
- Physical singleton: PASS

## Trusted publication

- Release-control branch: `integration/browser-dev-auto-update`
- Pointer commit: `34dece8466582f59509bff0cf52514f844b9adf2`
- Publisher run: `33271124840` PASS
- Tag: `v0.6.3-dev.65.1`
- Tag target: exact candidate source `3d90adae9b658971f005f2a5abb563112441ac47`
- Release is prerelease/dev-only; no rebuild; exact E2E bytes.

## Live updater baseline receipt

`SELF_UPDATE_STATUS` completed with `authority_effect=false` and reported:

- runtime schema `metaengine.self-update-runtime.v7`
- state `CURRENT`
- trusted_channel `dev`
- automatic_install `true`
- last_error `null`
- metadata_verified `false`
- available_version `null`
- downloaded_version `null`
- install_attempted_version `null`
- host resilience ACTIVE; sentinel ARMED

The live Edge Function currently drops `self_update` from persisted heartbeat state in `boundedState()`. This is an observability projection gap, not a Browser updater failure. Do not patch production authority during this test. Use typed `SELF_UPDATE_STATUS` receipts for live observation until a separately reviewed Edge projection patch is promoted.

## Completion criteria

Live PASS requires all of:

1. same `client_id` before and after update;
2. shell/extension version changes `0.6.3-dev.64.1 → 0.6.3-dev.65.1`;
3. no second live Browser identity/incarnation persists as authority;
4. updater reports verified candidate/download/install progression or durable successor evidence;
5. same supervisor conversation/profile survives;
6. no blind retry after ambiguous install effect.
