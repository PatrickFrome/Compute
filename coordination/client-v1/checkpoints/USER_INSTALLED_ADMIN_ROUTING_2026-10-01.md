# User-installed ADMIN connectivity — 2026-10-01 (Europe/Moscow)

Status: USER_INSTALLED_CONNECTION_AND_READ_COMMAND_PROVEN

Installer source: 93c64424525e00444a97abc151ef05bd386da3d7.
Installed version: 0.7.0-dev.36760350225.1.
The installed source and tested installer remain unchanged.

## Direct readbacks

Selected Meta project: jhriwwsryeqsvvvufkok.

At 2026-09-30T23:02:01.500538Z a signed enrollment request arrived from the previously known client 2a60d6a2-c7c2-4dcc-b4c9-99de768443c9. Metadata declared the exact candidate shell version and METAENGINE_BROWSER_ELECTRON_NATIVE. This is the user's new live request, separate from the Windows CI devices.

Request 3dcd5f78-ac4e-4b1c-a3d8-75c6208e4f44 was approved at 2026-09-30T23:05:21.003266Z through the existing approval RPC, fenced to request, client, public-key fingerprint, exact shell version, PENDING state and future expiry. No browser identity was manufactured and no private key or pairing secret was read or embedded.

Initial heartbeat was absent. Approval is not a claim, ADMIN readback or accepted heartbeat.

## Two proven backend defects

The actual stable v8 index has no /v1/admin/status route and uses DIRECT_POSTGRES with two query connections per isolate. The actual canary remains v25 (bundle bfab94d1acb6a55ef5e2c55bbfa561dfce94c8f4aaadc56064b556b91475c4fb), source pin 9b935a3dbd2c2722c0ff72a624d98b1c3a5542de.

After approval, live Postgres/management readback returned 53300. Logs counted 158, 263, 218 and 236 connection-slot failures in the respective 23:05–23:08 UTC minute buckets. Those are observations; the exact connection owners were not read back.

## Bounded repair

Keep the original stable handler for other clients. Forward the one approved installed client to the already qualified Meta canary. The proxy does not authenticate, issue credentials, schedule tasks or execute effects. The canary remains the device/signature/nonce/ADMIN authority. It receives the exact signed bytes and original logical service path.

The transport uses one submission, a bounded timeout, a fixed same-project destination, redirect refusal and a loop fence. Upstream signature denials are preserved. An uncertain forwarded outcome does not fall back to stable or resend.

This is a one-client compatibility repair, not fleet-wide production promotion or a completed R83 lease/result/rollback release seal.

## Verification and rollback

Behavioral tests: 8 PASS, 0 failed/skipped. Tests verify exact Unicode bytes/signature/nonce retention, upstream 401 preservation, unrelated-client noninterference, GET/no invented body, destination/path/loop rejection, ambiguous outcome/no resend and redirect refusal.

Before live apply the stable v8 body was saved byte-for-byte in stable-v8-rollback.ts. stable-client-qualified-routing.ts adds only the transport import, one-client configuration and pre-handler forwarding call. Re-deploy the original stable body to roll the router back; this does not roll back already accepted effects, revoke the device or authorize effect replay.

Required live exit evidence: same request CLAIMED, actual ADMIN device epoch, matching version, accepted fresh heartbeat and client cloud/admin state. Do not replace these with health, approval, fixture UI or CI evidence.

## Primary research

Reviewed the current Supabase changelog and official Edge Functions database guide:
- https://supabase.com/changelog
- https://supabase.com/docs/guides/functions/connect-to-postgres

The implemented path reuses the existing PostgREST qualification, rather than introducing another database/session owner. The current changelog includes PostgreSQL minor-version changes; this repair performs no database version upgrade or schema migration.

## Live qualification completed

Backend source 21507134bad46c2ecd2c0c0be150bb0ea7030893 was applied as stable version 9 (bundle 0953dd1971acfeaae9fe77d4c81e18446d134080d2990b0f957344dd1b2c2598). Deployed index and routing module were read back and exactly equal to published source. Canary v25 remains unchanged. This is a one-client routing repair; the installed app retains its default hostname.

The user's request was CLAIMED at 23:05:22.33865 UTC, bound to device 719bf900-9e50-44ec-b13b-fd998f33ba95 with ADMIN epoch 1. Heartbeat and command execution became readable after the routing fix. At 23:19:02 the heartbeat was 0.477 seconds old; at 23:22:20 it was 0.069 seconds old. Version matched the exact installer throughout, with no last_error. Compute was HEALTHY and Development Plane READY.

Read-only SYSTEM_TELEMETRY command 3ed84ccc-a2d7-48f4-9be5-afea29d6d483 was issued once at 23:20:45.425687 UTC, leased at 23:20:45.884494 and completed at 23:20:46.399166 with no error. It returned the actual installed observation-plane schema, four browser tabs and runtime fleet counts. This proves remote command pickup, installed execution and durable result readback.

The 23:19:00–23:22:00 UTC log window contained zero connection-slot errors (290 function log entries, two Postgres log entries). This short observation is not a permanent recovery guarantee.

## Remaining autonomous-work blockers

Live fleet: BOUND_UNVERIFIED=4, ACTIVE=0. Supervisor keepalive: ROLLOVER_AMBIGUOUS, cycle_seq=2109. These are not resolved by connection recovery. The installed profile retains historical ambiguous lifecycle state, which must be reconciled with exact Agent-origin/target evidence without blind prompt resend.

A separate observation defect is now proven: SYSTEM_TELEMETRY returns null supervisor fields while the actual heartbeat has the ambiguous keepalive state and cycle sequence. The read command calls nativeSupervisorState(), which omits supervisor_lifecycle/control state required by the observation projection. The next client candidate should fix this read-model input; it requires no scheduler change.

No visual inspection of the user's local ADMIN badge was performed, and no autonomous z.ai Agent goal-to-accepted-result loop was claimed. No user-side reinstall or client rebuild was required for the connection repair.
