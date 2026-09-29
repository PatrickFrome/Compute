# Push-Wake Edge Deploy Runbook (Tier 1 break #5)

## Situation

The LISTEN/NOTIFY wake hub is implemented and unit-tested at repo HEAD
(`apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/postgres-command-wake.mjs`,
7 passing tests in `test/postgres-command-wake.test.mjs`), but the deployed
edge function still runs the pre-hub build: `wait-batch` sleeps the full
long-poll budget and answers `DB_POLL_TIMEOUT_FALLBACK`, so command pickup
p50 stays at ~2s / worst case ~7s.

The database side is verified LIVE (2026-09-20 audit):

- `public.glm_browser_pulse_notify_v1()` emits `pg_notify('glm_browser_pulse', ...)`
- triggers attached: `glm_pulse_command` (AFTER INSERT+UPDATE on
  `compute_fabric_a2_browser_supervisor_command_h205f22`), `glm_pulse_state`,
  `glm_pulse_mesh`
- envelope keys `{client, cmd, command_id, status, action, ...}` are accepted
  by the HEAD hub's `parseWakePayload` (both legacy `{tbl,client}` and modern
  `{table,target_client_id,status}` shapes are handled)

The Agent Toolbelt issue route (`POST /v1/commands/issue-tool`) rides the same
edge function, so ONE deploy unlocks both push-wake and agent tools.

## Deploy (operator, ~2 minutes)

Supabase dashboard → project `xpeibufgzjknrhbhpffp` → Edge Functions →
`a2-browser-native-supervisor-v1` → replace the function source with
`apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts`
from branch `work/browser-shell-quantum-console-v1` (head at deploy time) →
deploy.

Verify the function secrets (unchanged): `SUPABASE_DB_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` (or anon).

`SUPABASE_DB_URL` must be the session pooler (`...pooler.supabase.com:5432`)
or the direct connection — LISTEN is unsupported on the transaction pooler
(port 6543).

CLI equivalent (if a token is available):

```
supabase functions deploy a2-browser-native-supervisor-v1 \
  --project-ref xpeibufgzjknrhbhpffp \
  --no-verify-jwt \
  --import-map apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/deno.json
```

## Post-deploy verification

1. `GET .../functions/v1/a2-browser-native-supervisor-v1/health` (no auth
   needed) must report:
   - `command_wait_batch: 'POSTGRES_NOTIFY_PROXY'`
   - `agent_tool_issue: true`
2. Issue a probe command (service_role, same RPC the brain uses) and watch
   the installed client's next `/v1/status`: `last_wait_batch_wake_reason`
   should flip from `DB_POLL_TIMEOUT_FALLBACK` to `POSTGRES_NOTIFY` /
   `POSTGRES_SUBSCRIBED_RECHECK`, and issue→COMPLETED latency should drop
   below ~500ms.
3. If wake stays `POSTGRES_LISTEN_UNAVAILABLE_DB_POLL_FALLBACK`: the
   `SUPABASE_DB_URL` is on the transaction pooler — switch it to the session
   pooler (port 5432) and redeploy.

## Rollback

Redeploy the previous function source (commit `c967dd82`). The wake hub is
additive: the durable DB lease remains the authority in both builds, and the
client treats every wake as a hint followed by the same authoritative lease
recheck.
