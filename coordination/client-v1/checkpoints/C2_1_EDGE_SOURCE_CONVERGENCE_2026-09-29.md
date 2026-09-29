# C2.1 Checkpoint — Exact Edge Source Convergence

Captured: 2026-09-29
Frozen Browser recovery baseline: ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

## IMPLEMENT

Updated only the isolated Supabase Edge canary:

- slug: a2-browser-native-supervisor-v14-canary
- previous version: 1
- new version: 2
- previous digest: b88e59e8be31f6f0a4c3d58605bad5753d45acf04e9c5a65fe7c8f28e02c9be3
- new digest: 780b6537584d96edc754bf389956e9c405a6713a823b6f9ef7995e954c116911
- all 10 GitHub raw imports now pin exact R109:
  ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

Production a2-browser-native-supervisor-v1 was not changed.

## VERIFY

Management readback confirms:
- status ACTIVE
- version 2
- digest 780b6537...
- 10/10 remote import pins equal exact R109

Database readback is NOT available. list_migrations and read-only SQL both fail with:
connect ECONNREFUSED ...:5432

Live function logs independently prove this is a real control-plane outage:
- production native supervisor requests return HTTP 502
- function logs contain native_supervisor_v13_failure connect ECONNREFUSED ...:5432
- some requests report "the database system is starting up"
- PostgREST also returns 503/PGRST002

Therefore Edge source convergence is proven, but DB contract/live qualification is not.

## RESEARCH

Supabase documentation treats the database as stateful and recommends applying database changes through migrations, with failed migrations rolled back. It also recommends development/branch isolation for changes before production convergence.

Client V1 consequence:
- do not blind-apply the Agent-origin migration while database readback is unavailable;
- keep promotion fail-closed;
- distinguish deployed Edge source evidence from live DB/runtime evidence.

Reference:
https://supabase.com/docs/guides/integrations/supabase-for-platforms

## STATUS

C2.1 EDGE_SOURCE = VERIFIED
C2.2 DB_CONTRACT = BLOCKED_INFRASTRUCTURE
C2.3 LIVE_QUALIFICATION = NOT_RUN

promotion_authorized = false
No frozen R109 Browser bytes changed.
