# User-installed ADMIN connectivity — 2026-10-01 (Europe/Moscow)

Status: SCOPED_ROUTING_PREPARED_LIVE_READBACK_PENDING

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
