# App integration — pointing the fabric at the Pigsty DB

## What changes now (server side)

The edge worker talks to the DB through `DB_URL`. Point it at the Pigsty
cluster:

```
postgres://postgres:<password>@<pigsty-host>:55432/postgres
```

- Use the DIRECT connection, not a transaction pooler port.
- Everything the fabric uses — pgmq queues, pg_cron jobs, the
  `supabase_realtime` publication, vault, RLS-free service-role access —
  exists on the Pigsty cluster unchanged (see RESTORE-REPORT-20260920.md).

## What does NOT change yet (client side)

The browser has exactly 3 hardcoded endpoints (auth is device HTTP
signatures — no embedded JWTs, no key rotation needed):

| File (`apps/metaengine-browser/src/`) | Constant | Current value |
|---|---|---|
| `native-supervisor-endpoints.mjs` | `NATIVE_SUPERVISOR_BASE` | `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1` |
| `native-supervisor-client-base.mjs` | `NATIVE_SUPERVISOR_BASE` | same |
| `self-update-signed-heartbeat.mjs` | `NATIVE_SUPERVISOR_HOST` | `xpeibufgzjknrhbhpffp.supabase.co` |

These reference an HTTPS functions endpoint, not the database. They stay
as-is until an HTTP API layer fronts the Pigsty DB:

- **Option A (recommended):** self-hosted Supabase stack on the same host —
  PostgREST / GoTrue / realtime / storage on top of the Pigsty PG. Client
  constants change to the new host; zero protocol changes.
- **Option B:** keep the edge worker as the only API surface; move its
  `DB_URL` to Pigsty; client untouched (works while the functions host stays
  alive or is replaced by a CF Worker route).

## Pinned tests

`rg -l "xpeibufgzjknrhbhpffp" apps/metaengine-browser/test/` — pinned-URL
contract tests reference the old host; update them in the same commit when
the constants change.

## Local dev (sandbox)

```bash
source infra/pigsty/bin/env.sh   # psql against the cluster
infra/pigsty/smoke.sh            # health check
```
