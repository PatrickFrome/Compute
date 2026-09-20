# Edge wake redeploy runbook — a2-browser-native-supervisor-v1 (v1)

## Status of this document

Operator action required. Agents cannot deploy Supabase Edge Functions:
the management API rejects the service_role key with 401 (verified live in the
W1 transport cycle — deploy + token issuance are user actions by design).

## Why this redeploy is the Tier 1 keystone

The live browser runs release `v0.7.0-dev.35487179754.1` whose CLIENT already
contains the full closed-loop wiring. The deployed EDGE is an older revision
that predates three capabilities the client now expects:

| Capability | Repo edge | Deployed edge | Effect of the gap |
|---|---|---|---|
| wait-batch wake | `POSTGRES_NOTIFY_PROXY` / `REALTIME_BROADCAST_PROXY` (LISTEN hub on `glm_browser_pulse`) | `BOUNDED_DB_POLL` | Command pickup waits out the full 4s poll budget (live p50 2.7–6.9s issue→COMPLETED) |
| Result receipt readback | `GET /v1/commands/{id}/receipt` | missing | `readStoredReceipt` returns null → `onRsiOutcomeReadback` drops → **zero RSI outcome episodes** (Outcome River blocked at transport) |
| Batch ambiguity reconciliation | per-command readback-before-replay | older batch path | degraded ambiguity recovery |

The DB side is already live and verified (2026-09-20):

- trigger `glm_pulse_command` on
  `public.compute_fabric_a2_browser_supervisor_command_h205f22` — ENABLED (`O`),
  backed by `public.glm_browser_pulse_notify_v1()` (per-field exception guards,
  `pg_notify('glm_browser_pulse', {tbl, op, client, cmd, action, status})`);
- the same function emits the fail-soft private `realtime.send` COMMAND_AVAILABLE
  broadcast when a command enters PENDING (used only when a legacy
  JWT-shaped service key is present — the NOTIFY pulse is the primary wake).

## Deploy steps (operator, ~5 minutes)

From the repository root (branch containing this document, or any head at or
after the Quantum Console merge `2fd515ab`):

```bash
supabase login                      # one-time; personal access token (sbp_...)
supabase link --project-ref xpeibufgzjknrhbhpffp

supabase functions deploy a2-browser-native-supervisor-v1 \
  --project-ref xpeibufgzjknrhbhpffp \
  --no-verify-jwt \
  --functions-dir apps/metaengine-browser/supabase
```

Required secrets are already configured in the project
(`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`); the function reads them via
`Deno.env.get`. Do not change them.

## Post-deploy verification (read-only, no auth needed for /health)

```bash
curl -s https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1/health | jq .
```

Expected changes vs the pre-deploy snapshot:

- `"command_wait_batch"`: `"BOUNDED_DB_POLL"` → `"POSTGRES_NOTIFY_PROXY"`
  (or `"REALTIME_BROADCAST_PROXY"` if a JWT-shaped service key is configured);
- `"postgres_notify_wake": true` (already advertised, now actually exercised);
- `"result_receipt_readback": true` (route now exists on the deployed edge).

Live client convergence (watch the supervisor state row in
`public.compute_fabric_a2_browser_supervisor_state_h205f22`, key
`state->'control_fast_lane'`):

1. `last_wait_batch_wake_reason` flips from `DB_POLL_TIMEOUT_FALLBACK` to
   `POSTGRES_NOTIFY` (or `POSTGRES_SUBSCRIBED_RECHECK`) within one wait cycle;
2. `batch_fastlane_mode` flips `POLLING` → `SUSPENDED` (the wake-aware batch
   fastlane self-suspends on notify evidence — no extra lease traffic in
   steady state);
3. `last_wait_batch_elapsed_ms` collapses to sub-second on command arrival;
4. `state->'rsi_outcome_readback'` counters start moving: `observed_count`
   grows per command and `state->'rsi'->'browser_outcome_ingest'->'outcome_count'`
   grows — the Outcome River starts flowing.

## Rollback

Redeploy the previous edge revision (git checkout of the pre-wake commit,
same deploy command). The client is backward compatible: on `DB_POLL_*`
wake reasons the batch fastlane reactivates automatically, so pickup latency
returns to the ~0.6s accelerator path instead of the old 4s poll.

## Security invariants preserved by this deploy

- Wake hints are never authority: `postgres_notify_delivery_is_authority:
  false`, `command_wake_delivery_is_authority: false`; durable DB leasing
  remains the only command authority.
- The receipt readback route is device-signed read-only (`GET`, same
  `authenticateDevice` gate as every other route) and
  `result_receipt_readback_is_authority: false`.
- No DDL changes are required for this deploy; all migrations involved
  (`20260906093000`, `20260906163500`) are already applied and live.
