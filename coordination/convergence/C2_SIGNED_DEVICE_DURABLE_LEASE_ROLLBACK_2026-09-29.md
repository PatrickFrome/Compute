# C2 SIGNED DEVICE, DURABLE LEASE AND ROLLBACK QUALIFICATION — 2026-09-29

## Scope
This checkpoint advances Client V1 distributed qualification on the fresh Supabase project
`jhriwwsryeqsvvvufkok` without modifying frozen R109
`ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551`.

Product successor branch:
`work/client-v1-c2-new-supabase-rehome-v1`.

## Signed device transport proven
Dedicated workflow:
`Client V1 Signed Enrollment Live Qualification`.

Successful run:
`36559917708`.

Exact source head:
`bea6543d05abec85420fc554ee450b06d3acc2dc`.

The run proved:
- fresh P-256 device identity,
- signed public enrollment request,
- explicit service-role approval of that exact request only,
- APPROVED -> CLAIMED activation,
- signed POST `/v1/state` -> HTTP 202,
- signed GET `/v1/status` -> HTTP 200,
- DB state identity matches the activated device key fingerprint,
- no automatic approval and no browser authority granted by transport delivery.

## Serverless LISTEN defect found and repaired
Live qualification exposed a mismatch between Edge/serverless DB connectivity and Postgres
session semantics. The prior Edge code attempted `.listen()` on `SUPABASE_DB_URL`.
The live request could remain parked instead of reaching the bounded durable re-lease path.

Repair:
- query pool remains on `SUPABASE_DB_URL`,
- Postgres LISTEN is enabled only with explicit `SUPABASE_DB_SESSION_URL`,
- without a proven session URL, wait-batch performs one bounded wait followed by the same
  authoritative durable DB lease,
- health reports `BOUNDED_DB_POLL` instead of falsely advertising Postgres NOTIFY,
- no second scheduler or retry loop was introduced.

Current stable Edge:
`a2-browser-native-supervisor-v1` version 5.

Current canary after restore:
`a2-browser-native-supervisor-v14-canary` version 10.

Exact current Edge source pin:
`3063871fe9a8a16cc879e630dc7a40105e835512`.

Current bundle digest:
`9810286554c7eae7d2a039f72defbc0e50d80a906cdfa8945d8a8741f6c6aa9f`.

## Durable lease and terminal receipt proven
The qualification first proved an empty bounded serverless fallback, then entered a serial
durable command wait phase.

Trusted issuer created exactly one READ_ONLY `POLL`:
- command_id: `0906d8a8-e70b-49e1-a2f9-1637bd3fb0f9`
- idempotency key: `client-v1-live:36559917708:durable-readonly`
- execution_authority: false
- automatic_retry_allowed: false
- authority_effect: false

Observed timeline:
- issued: 11:10:02.526 UTC
- leased by exact signed client: 11:10:03.845 UTC
- completed: 11:10:06.508 UTC
- signed terminal receipt readback returned HTTP 200.

Terminal receipt:
- effect_outcome: `NO_EFFECT_PROVEN`
- authority_effect: false.

This proves the canonical correctness path:
`bounded wait -> durable DB re-lease -> signed result -> independent terminal receipt readback`.

## Research decision
Postgres LISTEN/NOTIFY is an optional latency accelerator, not an authority gate.
Transaction-pooled/serverless connectivity does not guarantee session-scoped LISTEN semantics.
A future explicit session-capable URL may re-enable the accelerator, but durable DB leasing
remains authoritative before and after every wake.

R83 was therefore updated explicitly:
- `bounded_durable_lease_readback_required=true`
- `result_receipt_readback_required=true`
- `postgres_notify_accelerator_required=false`
- no hidden weakening of promotion or release authority.

## Canary rollback drill proven
A canary-only rollback drill was performed; stable production slug was not rolled back.

1. Canary was deployed from previous proven source
   `d0caf994fffb22a863a68d99255e181d1a3acbd3`
   as version 9, digest
   `b6a280c00204e35ff0b24d118451d8b8cc7e43119b4f8624b477ba6625b07a5d`.
2. External live health returned HTTP 200.
3. Canary was restored to exact current source
   `3063871fe9a8a16cc879e630dc7a40105e835512`
   as version 10, digest
   `9810286554c7eae7d2a039f72defbc0e50d80a906cdfa8945d8a8741f6c6aa9f`.
4. Independent post-restore readback proved HTTP 200,
   `runtime_ready=true`, capability state `ATTESTED`,
   reason `EXACT_DB_SOURCE_MATCH`, and `authority_effect=false`.

## Remaining gate
R83 overall live qualification intentionally remains incomplete.
The remaining material gate is installed-Electron signed E2E:
the exact installed Browser artifact must enroll, be explicitly approved, emit signed state,
lease/complete a read-only command and prove receipt readback as an installed application.

Until that is proven:
- `live_qualification.completed=false`
- `promotion_authorized=false`
- `authority_effect=false`.
