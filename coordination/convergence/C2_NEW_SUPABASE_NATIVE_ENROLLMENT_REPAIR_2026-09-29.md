# C2 NEW SUPABASE — NATIVE DEVICE ENROLLMENT REPAIR — 2026-09-29

## Trigger
Fresh-project reconciliation found that the R109 Edge runtime referenced:
- `public.compute_fabric_a2_browser_device_enrollment_request_h205f22`
- `public.h205f22_a2_browser_device_activate_approved_v1(...)`

but neither object existed in the tracked historical migration ledger applied to a blank project.
This meant a fresh Client V1 recovery project could pass static Edge/source checks while the first physical Browser enrollment request would fail at runtime.

## Repair
Successor branch:
`work/client-v1-c2-new-supabase-rehome-v1`

Migration:
`supabase/migrations/20260929020000_client_v1_native_device_enrollment_v1.sql`

It adds:
- durable signed enrollment request table,
- explicit PENDING -> APPROVED -> CLAIMED lifecycle,
- service-role-only approval/rejection RPCs,
- exact request/client/profile/fingerprint/JWK binding before activation,
- activation through the existing proven `h205f22_a2_browser_device_enroll_v1` primitive,
- server-generated pairing grant hash,
- RLS deny-by-default for public/authenticated callers,
- no device auto-approval.

Live new-project transaction smoke proved:
`request -> explicit approve -> activate -> device + pairing readback`.
The transaction was rolled back after assertions.

A regression test was added at:
`apps/metaengine-browser/test/client-v1-native-device-enrollment-bootstrap.test.mjs`.

## CI repair
The new deployment-slug routing regression test had accidentally been committed with literal `\n` separators.
That caused Shell, Self Update E2E and the full Critical Audit suite to fail only because Node could not parse the test file.
Commit `aec0fb7f6575ac496209375113c13d98774e70aa` replaces those literals with real line breaks.

## R83 re-pin
Because R83 deliberately proves there is no Edge/migration drift between the deployed source pin and the candidate, adding the enrollment migration correctly made the old pin fail static equivalence.

The canary was therefore rebuilt from exact successor source after the enrollment bootstrap:
- project: `jhriwwsryeqsvvvufkok`
- function: `a2-browser-native-supervisor-v14-canary`
- version: 4
- source pin: `a1e64db07abfd5206f92100cb39e18ce0de1e34b`
- bundle digest: `092faadd937f0074576cf4a9219bdcca705000701041187a315e2167ae2768e1`

Manifest successor commit:
`dfefc3cc196fddba78e55f560e3fe558c68ba444`.

R83 static qualification on exact manifest head is SUCCESS.
Live qualification remains intentionally incomplete; no promotion authority has been claimed.

## Current gate
Wait for the complete exact-head CI matrix on `dfefc3cc196fddba78e55f560e3fe558c68ba444`.
If green, next safe step is physical Client V1 qualification against the new stable project endpoint, with explicit device enrollment approval and signed state/heartbeat readback.
