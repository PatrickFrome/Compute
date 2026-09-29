# C2 WAKE ORACLE RESEARCH AND REPAIR — 2026-09-29

## Trigger
Exact head `1cb04041822c7bc8f1f145e22499d0c971ed9d04` reached terminal CI and exposed one stale regression oracle:
`apps/metaengine-browser/test/r83-edge-v14-canary-source-binding.test.mjs`
still required the literal source token `postgres_notify_wake:true`.

That expectation no longer matched the deliberately session-aware runtime:
- durable DB lease remains the authority path;
- Postgres LISTEN/NOTIFY is only a wake accelerator;
- when no session-capable DB URL exists, wait-batch sleeps for a bounded interval and rechecks the same durable lease path;
- the live Client V1 qualification already proved that bounded fallback with a terminal POLL receipt.

## Research
Supabase current connection guidance distinguishes:
- transaction pooler for serverless / Edge functions and short-lived query traffic;
- direct or session-mode connections for session-state features;
- transaction mode does not preserve session state such as LISTEN/NOTIFY.

This supports the current split:
- `SUPABASE_DB_URL` may serve short-lived authoritative lease/query traffic;
- `SUPABASE_DB_SESSION_URL` is required only for the LISTEN accelerator;
- absence of that session URL must not imply absence of durable command authority.

## Repair
Product branch commit:
`7beb7e718a5cae0a4353302d449e5a4f0dec1fd9`

The stale test now proves:
- `postgres_notify_wake:Boolean(DB_SESSION_URL)`;
- command wait mode selects exactly one of:
  - `REALTIME_BROADCAST_PROXY`,
  - `POSTGRES_NOTIFY_PROXY`,
  - `BOUNDED_DB_POLL`.

No runtime authority or retry behavior was widened.

## Next verification
Re-run exact-head Critical Audit and Self Update contract gates.
If green, resume the physical installed-Electron qualification gate and do not mark R83 live qualification complete before installed signed readback is proven.
