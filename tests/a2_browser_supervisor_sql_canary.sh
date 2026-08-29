#!/usr/bin/env bash
# A2 Browser Supervisor control-plane SQL canary (PostgreSQL 17).
#
# Follows the tests/chat_bridge_receipt_sql_canary.sh precedent: apply the
# full supervisor migration chain to an empty PostgreSQL 17 and assert the
# at-most-once command backbone semantics with positive, negative, and
# adversarial probes. This is the executable contract for migrations
# 20260827043107 (v1 control plane) through 20260827141000 (v4 atomic
# result). Documentation claims are not runtime proof; this canary is.
#
# Proven semantics:
#   - enqueue idempotency: exact replay returns the same command; conflicting
#     replay is rejected (supervisor_idempotency_conflict)
#   - stale leases are TERMINAL (lease_timeout_no_retry), never requeued
#   - SET_SUPERVISOR_MODE is reserved for the bootstrap authority lane
#   - weighted action budget (24/60s) and failure circuit (5/60s) block
#     non-emergency commands; DISARM / SET_SUPERVISOR_MODE(OFF) always bypass
#   - complete_v4 accepts only a current, unexpired, self-owned lease and is
#     the only observed authority_effect writer
#   - privilege boundary: service_role may execute lane RPCs; anon and
#     authenticated may not; RLS stays enabled on both tables
#
# Local runs without docker: export A2_CANARY_PSQL=/path/to/psql and point
# PGHOST/PGPORT at a running PostgreSQL 17. CI uses the docker psql client
# against the postgres:17 service container, exactly like the chat-bridge
# receipt canary.
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=supervisor_canary}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD

if [[ -n "${A2_CANARY_PSQL:-}" ]]; then
  psql17() {
    "$A2_CANARY_PSQL" -X -v ON_ERROR_STOP=1 \
      -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  }
else
  psql17() {
    docker run --rm -i --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      postgres:17 \
      psql -X -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  }
fi

for _ in $(seq 1 60); do
  if [[ -n "${A2_CANARY_PSQL:-}" ]]; then
    if "$A2_CANARY_PSQL" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
        -tAc 'select 1' >/dev/null 2>&1; then
      break
    fi
  elif docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
      pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# Bootstrap the Supabase-shaped roles/schemas the migrations expect.
# ---------------------------------------------------------------------------
psql17 <<'SQL'
create schema if not exists extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create extension if not exists pgcrypto with schema extensions;
SQL

# ---------------------------------------------------------------------------
# Apply the FULL supervisor migration chain in filename (timestamp) order.
# stdin redirection (not psql -f) keeps this working through the dockerized
# client, mirroring the chat-bridge receipt canary.
# ---------------------------------------------------------------------------
for mig in $(ls supabase/migrations/*a2_browser_supervisor*.sql | sort); do
  echo "applying ${mig}"
  psql17 < "$mig" > /dev/null
done

# ---------------------------------------------------------------------------
# Phase A — enqueue idempotency (v2/v3 lanes).
# ---------------------------------------------------------------------------
psql17 <<'SQL'
do $$
declare
  v_ws uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  v_a jsonb;
  v_b jsonb;
  v_seen boolean;
  v_count integer;
begin
  -- A1 fresh issue (v3 lane)
  v_a := public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'CAPTURE','GLM_ZAI','{"x":1}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:001');
  if v_a->>'replayed' <> 'false'
     or v_a->>'status' <> 'PENDING'
     or v_a->>'action' <> 'CAPTURE'
     or v_a->>'idempotency_key' <> 'canary:20260829:enqueue:001'
     or v_a->>'authority_effect' <> 'false' then
    raise exception 'canary_enqueue_fresh_shape';
  end if;

  -- A2 exact replay returns the SAME command
  v_b := public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'CAPTURE','GLM_ZAI','{"x":1}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:001');
  if v_b->>'replayed' <> 'true'
     or v_b->>'command_id' <> v_a->>'command_id' then
    raise exception 'canary_enqueue_replay_identity_changed';
  end if;

  -- A3 conflicting payload replay rejected
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'CAPTURE','GLM_ZAI','{"x":2}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:001');
  exception when others then
    if sqlerrm <> 'supervisor_idempotency_conflict' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_conflicting_payload_replay_accepted'; end if;

  -- A4 conflicting action replay rejected
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL','GLM_ZAI','{"x":1}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:001');
  exception when others then
    if sqlerrm <> 'supervisor_idempotency_conflict' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_conflicting_action_replay_accepted'; end if;

  -- A5 invalid action
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'DESTROY',null,'{}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:bad1');
  exception when others then
    if sqlerrm <> 'supervisor_action_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_invalid_action_accepted'; end if;

  -- A6 invalid platform
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL','SLACK','{}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:bad2');
  exception when others then
    if sqlerrm <> 'supervisor_platform_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_invalid_platform_accepted'; end if;

  -- A7 short idempotency key
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL',null,'{}'::jsonb,null,300,'CANARY_ISSUER','short');
  exception when others then
    if sqlerrm <> 'supervisor_idempotency_key_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_short_key_accepted'; end if;

  -- A8 bad-charset idempotency key
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL',null,'{}'::jsonb,null,300,'CANARY_ISSUER','has spaces and unicode');
  exception when others then
    if sqlerrm <> 'supervisor_idempotency_key_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_bad_charset_key_accepted'; end if;

  -- A9 NULL idempotency key rejected (key is required on v2/v3 lanes)
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL',null,'{}'::jsonb,null,300,'CANARY_ISSUER',null);
  exception when others then
    if sqlerrm <> 'supervisor_idempotency_key_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_null_key_accepted'; end if;

  -- A10 v2 rollback-compat lane keeps identical replay semantics
  v_a := public.h205f22_a2_browser_supervisor_enqueue_v2(
    v_ws,'POLL','CHATGPT','{}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:002');
  v_b := public.h205f22_a2_browser_supervisor_enqueue_v2(
    v_ws,'POLL','CHATGPT','{}'::jsonb,null,300,'CANARY_ISSUER','canary:20260829:enqueue:002');
  if v_a->>'replayed' <> 'false' or v_b->>'replayed' <> 'true'
     or v_b->>'command_id' <> v_a->>'command_id' then
    raise exception 'canary_v2_replay_identity_broken';
  end if;

  -- A11 v1 has no idempotency (documented regression reason for v2)
  perform public.h205f22_a2_browser_supervisor_enqueue_v1(
    v_ws,'POLL',null,'{}'::jsonb,null,300,'CANARY_V1_PROBE');
  perform public.h205f22_a2_browser_supervisor_enqueue_v1(
    v_ws,'POLL',null,'{}'::jsonb,null,300,'CANARY_V1_PROBE');
  select count(*) into v_count
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id = v_ws and issued_by = 'CANARY_V1_PROBE';
  if v_count <> 2 then
    raise exception 'canary_v1_nonidempotency_changed (% rows)', v_count;
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Phase B — lease lanes, mode gates, targeting, terminal reap.
# ---------------------------------------------------------------------------
psql17 <<'SQL'
do $$
declare
  v_ws uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  v_r jsonb;
  v_cmd uuid;
  v_status text;
  v_error text;
begin
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'SET_SUPERVISOR_MODE',null,'{"mode":"CONTROL"}'::jsonb,null,300,'CANARY','canary:20260829:lane:mode');
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'CAPTURE',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:capture');
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'DISARM',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:disarm');
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,'canary-client-a',300,'CANARY','canary:20260829:lane:poll-a');

  -- B1 CONTROL lane never serves SET_SUPERVISOR_MODE (bootstrap reservation);
  -- oldest eligible is CAPTURE.
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'CAPTURE' then
    raise exception 'canary_control_lane_served_reserved_action (%)', v_r->'command'->>'action';
  end if;

  -- B2 CONTROL lane does serve DISARM (emergency reachable without bootstrap)
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'DISARM' then
    raise exception 'canary_control_lane_disarm_not_served (%)', v_r->'command'->>'action';
  end if;

  -- B3 bootstrap lane serves the reserved SET_SUPERVISOR_MODE
  v_r := public.h205f22_a2_browser_supervisor_lease_bootstrap_v3(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'SET_SUPERVISOR_MODE' then
    raise exception 'canary_bootstrap_lane_mode_not_served (%)', v_r->'command'->>'action';
  end if;

  -- B4 target isolation: client-b cannot lease a command targeted at client-a
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-b');
  if (v_r->'command'->>'command_id') is not null then
    raise exception 'canary_target_isolation_broken';
  end if;
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'POLL' then
    raise exception 'canary_targeted_command_not_delivered_to_owner';
  end if;

  -- B4b v2 compatibility route still leases (lease_v2 -> lease_control_v4)
  perform public.h205f22_a2_browser_supervisor_enqueue_v2(
    v_ws,'POLL',null,'{}'::jsonb,null,3000,'CANARY','canary:20260829:lane:v2route');
  v_r := public.h205f22_a2_browser_supervisor_lease_v2(v_ws,'canary-client-a');
  if (v_r->'command'->>'idempotency_key') <> 'canary:20260829:lane:v2route' then
    raise exception 'canary_v2_route_lease_broken (%)', v_r->'command'->>'idempotency_key';
  end if;

  -- B5 bootstrap lane prioritizes DISARM over an older ARM
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'ARM',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:arm');
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'DISARM',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:disarm2');
  v_r := public.h205f22_a2_browser_supervisor_lease_bootstrap_v3(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'DISARM' then
    raise exception 'canary_bootstrap_disarm_priority_broken (%)', v_r->'command'->>'action';
  end if;
  v_r := public.h205f22_a2_browser_supervisor_lease_bootstrap_v3(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'ARM' then
    raise exception 'canary_bootstrap_arm_followup_broken (%)', v_r->'command'->>'action';
  end if;

  -- B6 OFF-mode clients may only lease mode-changing commands via lease_v3
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'CAPTURE',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:capture2');
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'ARM',null,'{}'::jsonb,null,300,'CANARY','canary:20260829:lane:arm2');
  v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,'canary-client-a','OFF');
  if (v_r->'command'->>'action') <> 'ARM' then
    raise exception 'canary_off_mode_gate_broken (%)', v_r->'command'->>'action';
  end if;

  -- B6b drain capture2 so the reaper probes lease a known command
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'action') <> 'CAPTURE' then
    raise exception 'canary_capture2_drain_broken (%)', v_r->'command'->>'action';
  end if;

  -- B7 stale lease is TERMINAL: expired lease is reaped with
  -- lease_timeout_no_retry and never handed out again (at-most-once).
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,null,3000,'CANARY','canary:20260829:reap:terminal');
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  v_cmd := (v_r->'command'->>'command_id')::uuid;
  if (v_r->'command'->>'idempotency_key') <> 'canary:20260829:reap:terminal' then
    raise exception 'canary_reap_setup_lease_mismatch';
  end if;
  -- simulate lease timeout: backdate the lease beyond the 120s default guard
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set leased_at = clock_timestamp() - interval '600 seconds'
   where command_id = v_cmd;
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'command_id') = v_cmd::text then
    raise exception 'canary_terminal_lease_requeued';
  end if;
  select status, coalesce(error,'') into v_status, v_error
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd;
  if v_status <> 'EXPIRED' or v_error <> 'lease_timeout_no_retry' then
    raise exception 'canary_terminal_reap_status_wrong (%/%)', v_status, v_error;
  end if;

  -- B8 stale PENDING command expires before lease and is never leased
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,null,3000,'CANARY','canary:20260829:reap:pending');
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set expires_at = clock_timestamp() - interval '1 second'
   where workspace_id = v_ws
     and idempotency_key = 'canary:20260829:reap:pending'
     and status = 'PENDING';
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,'canary-client-a');
  if (v_r->'command'->>'idempotency_key') = 'canary:20260829:reap:pending' then
    raise exception 'canary_stale_pending_leased';
  end if;
  select status, coalesce(error,'') into v_status, v_error
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id = v_ws and idempotency_key = 'canary:20260829:reap:pending';
  if v_status <> 'EXPIRED' or v_error <> 'command_expired_before_lease' then
    raise exception 'canary_stale_pending_status_wrong (%/%)', v_status, v_error;
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Phase C — weighted action budget + failure circuit (lease_v3, v4 guard).
# ---------------------------------------------------------------------------
psql17 <<'SQL'
do $$
declare
  v_ws uuid := 'cccccccc-0000-4000-8000-00000000000c';
  v_budget_client text := 'canary-budget-client';
  v_circuit_client text := 'canary-circuit-client';
  v_r jsonb;
  v_i integer;
  v_cmd uuid;
  v_status text;
  v_error text;
begin
  -- C1 six RESOLVE_PROMPT leases exhaust the 24-point budget (4 x 6)
  for v_i in 1..6 loop
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'RESOLVE_PROMPT',null,'{}'::jsonb,v_budget_client,3000,'CANARY',
      'canary:20260829:budget:0' || v_i::text);
    v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_budget_client,'CONTROL');
    if (v_r->'command') is null
       or (v_r->'command'->>'action') <> 'RESOLVE_PROMPT' then
      raise exception 'canary_budget_lease_%_unexpectedly_blocked', v_i;
    end if;
  end loop;

  -- C2 the seventh exceeds the budget: command is FAILED, guard blocks
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'RESOLVE_PROMPT',null,'{}'::jsonb,v_budget_client,3000,'CANARY','canary:20260829:budget:07');
  v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_budget_client,'CONTROL');
  if (v_r->'command'->>'command_id') is not null then
    raise exception 'canary_budget_exceeded_still_leased';
  end if;
  if (v_r->'guard'->>'blocked') <> 'true'
     or (v_r->'guard'->>'reason') <> 'ACTION_BUDGET_EXCEEDED' then
    raise exception 'canary_budget_guard_shape_wrong (%)', v_r->'guard';
  end if;
  select status, coalesce(error,'') into v_status, v_error
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id = v_ws and idempotency_key = 'canary:20260829:budget:07';
  if v_status <> 'FAILED' or v_error <> 'supervisor_action_budget_exceeded' then
    raise exception 'canary_budget_blocked_status_wrong (%/%)', v_status, v_error;
  end if;

  -- C3 zero-cost POLL still passes for an exhausted client
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,v_budget_client,3000,'CANARY','canary:20260829:budget:poll');
  v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_budget_client,'CONTROL');
  if (v_r->'command'->>'action') <> 'POLL' then
    raise exception 'canary_zero_cost_poll_blocked';
  end if;

  -- C4 failure circuit: five failed completions open the circuit
  for v_i in 1..5 loop
    perform public.h205f22_a2_browser_supervisor_enqueue_v3(
      v_ws,'POLL',null,'{}'::jsonb,v_circuit_client,3000,'CANARY',
      'canary:20260829:circuit:f' || v_i::text);
    v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_circuit_client,'CONTROL');
    v_cmd := (v_r->'command'->>'command_id')::uuid;
    perform public.h205f22_a2_browser_supervisor_complete_v4(
      v_ws,v_cmd,v_circuit_client,false,'{}'::jsonb,'canary_forced_failure',false);
  end loop;

  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'CAPTURE',null,'{}'::jsonb,v_circuit_client,3000,'CANARY','canary:20260829:circuit:next');
  v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_circuit_client,'CONTROL');
  if (v_r->'command'->>'command_id') is not null then
    raise exception 'canary_circuit_open_still_leased';
  end if;
  if (v_r->'guard'->>'blocked') <> 'true'
     or (v_r->'guard'->>'reason') <> 'FAILURE_CIRCUIT_OPEN' then
    raise exception 'canary_circuit_guard_shape_wrong (%)', v_r->'guard';
  end if;
  select status, coalesce(error,'') into v_status, v_error
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id = v_ws and idempotency_key = 'canary:20260829:circuit:next';
  if v_status <> 'FAILED' or v_error <> 'supervisor_failure_circuit_open' then
    raise exception 'canary_circuit_blocked_status_wrong (%/%)', v_status, v_error;
  end if;

  -- C5 DISARM always bypasses the open circuit (emergency lane)
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'DISARM',null,'{}'::jsonb,v_circuit_client,3000,'CANARY','canary:20260829:circuit:disarm');
  v_r := public.h205f22_a2_browser_supervisor_lease_v3(v_ws,v_circuit_client,'OFF');
  if (v_r->'command'->>'action') <> 'DISARM' then
    raise exception 'canary_emergency_disarm_blocked_by_circuit';
  end if;
  if coalesce((v_r->'guard'->>'blocked'),'false') <> 'false' then
    raise exception 'canary_emergency_guard_blocked_flag_set';
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Phase D — complete_v4 atomic completion semantics.
# ---------------------------------------------------------------------------
psql17 <<'SQL'
do $$
declare
  v_ws uuid := 'dddddddd-0000-4000-8000-00000000000d';
  v_client text := 'canary-complete-client';
  v_r jsonb;
  v_cmd uuid;
  v_cmd2 uuid;
  v_receipt jsonb;
  v_status text;
  v_error text;
  v_seen boolean;
begin
  -- D1 successful completion carries the receipt and authority_effect
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,v_client,3000,'CANARY','canary:20260829:complete:ok');
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,v_client);
  v_cmd := (v_r->'command'->>'command_id')::uuid;
  v_r := public.h205f22_a2_browser_supervisor_complete_v4(
    v_ws,v_cmd,v_client,true,'{"r":1}'::jsonb,null,true);
  if v_r->>'accepted' <> 'true'
     or v_r->>'status' <> 'COMPLETED'
     or v_r->>'authority_effect' <> 'true' then
    raise exception 'canary_complete_ok_shape (%)', v_r;
  end if;
  select status, receipt, authority_effect into v_status, v_receipt, v_seen
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd;
  if v_status <> 'COMPLETED' or (v_receipt->>'r') <> '1' or v_seen is not true then
    raise exception 'canary_complete_row_mismatch';
  end if;

  -- D2 enqueue_v3 replay after completion reports CURRENT state
  v_r := public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,v_client,3000,'CANARY','canary:20260829:complete:ok');
  if v_r->>'replayed' <> 'true'
     or v_r->>'status' <> 'COMPLETED'
     or v_r->>'authority_effect' <> 'true'
     or (v_r->>'command_id')::uuid <> v_cmd then
    raise exception 'canary_replay_after_completion_shape (%)', v_r;
  end if;

  -- D3 double completion is rejected without mutating the terminal row
  v_receipt := null;
  begin
    v_r := public.h205f22_a2_browser_supervisor_complete_v4(
      v_ws,v_cmd,v_client,true,'{"r":999}'::jsonb,null,false);
  exception when others then
    raise exception 'canary_double_complete_raised (%)', sqlerrm;
  end;
  if v_r->>'accepted' <> 'false'
     or v_r->>'error' <> 'supervisor_lease_not_current' then
    raise exception 'canary_double_complete_accepted (%)', v_r;
  end if;
  select receipt into v_receipt
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd;
  if (v_receipt->>'r') <> '1' then
    raise exception 'canary_double_complete_mutated_receipt';
  end if;

  -- D4 non-owner completion is rejected and the lease survives
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,v_client,3000,'CANARY','canary:20260829:complete:steal');
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,v_client);
  v_cmd2 := (v_r->'command'->>'command_id')::uuid;
  v_r := public.h205f22_a2_browser_supervisor_complete_v4(
    v_ws,v_cmd2,'canary-attacker-client',true,'{"evil":true}'::jsonb,null,false);
  if v_r->>'accepted' <> 'false' then
    raise exception 'canary_nonowner_complete_accepted';
  end if;
  select status into v_status
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd2;
  if v_status <> 'LEASED' then
    raise exception 'canary_nonowner_complete_mutated_lease (%)', v_status;
  end if;

  -- D5 expired-lease completion reports EXPIRED without mutating the row
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set expires_at = clock_timestamp() - interval '1 second'
   where command_id = v_cmd2;
  v_r := public.h205f22_a2_browser_supervisor_complete_v4(
    v_ws,v_cmd2,v_client,true,'{"r":1}'::jsonb,null,false);
  if v_r->>'accepted' <> 'false'
     or v_r->>'error' <> 'supervisor_lease_expired' then
    raise exception 'canary_expired_complete_accepted (%)', v_r;
  end if;
  select status into v_status
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd2;
  if v_status <> 'LEASED' then
    raise exception 'canary_expired_complete_mutated_row (%)', v_status;
  end if;

  -- D6 failed completion records the error and clears the receipt
  perform public.h205f22_a2_browser_supervisor_enqueue_v3(
    v_ws,'POLL',null,'{}'::jsonb,v_client,3000,'CANARY','canary:20260829:complete:fail');
  v_r := public.h205f22_a2_browser_supervisor_lease_control_v4(v_ws,v_client);
  v_cmd := (v_r->'command'->>'command_id')::uuid;
  v_r := public.h205f22_a2_browser_supervisor_complete_v4(
    v_ws,v_cmd,v_client,false,'{}'::jsonb,'dom_failure',false);
  if v_r->>'accepted' <> 'true' or v_r->>'status' <> 'FAILED' then
    raise exception 'canary_complete_fail_shape (%)', v_r;
  end if;
  select status, coalesce(error,''), receipt is null into v_status, v_error, v_seen
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id = v_cmd;
  if v_status <> 'FAILED' or v_error <> 'dom_failure' or v_seen is not true then
    raise exception 'canary_complete_fail_row_mismatch (%/%/%)', v_status, v_error, v_seen;
  end if;

  -- D7 unknown command id raises
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_complete_v4(
      v_ws,'99999999-9999-4999-8999-999999999999'::uuid,v_client,true,null,null,false);
  exception when others then
    if sqlerrm <> 'supervisor_command_not_found' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_unknown_command_accepted'; end if;

  -- D8 invalid identity raises
  v_seen := false;
  begin
    perform public.h205f22_a2_browser_supervisor_complete_v4(
      v_ws,null,v_client,true,null,null,false);
  exception when others then
    if sqlerrm <> 'supervisor_result_identity_invalid' then raise; end if;
    v_seen := true;
  end;
  if not v_seen then raise exception 'canary_invalid_identity_accepted'; end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Phase E — schema and privilege invariants.
# ---------------------------------------------------------------------------
psql17 <<'SQL'
do $$
declare
  v_fns text[] := array[
    'public.h205f22_a2_browser_supervisor_enqueue_v2(uuid,text,text,jsonb,text,integer,text,text)',
    'public.h205f22_a2_browser_supervisor_enqueue_v3(uuid,text,text,jsonb,text,integer,text,text)',
    'public.h205f22_a2_browser_supervisor_lease_v2(uuid,text,integer)',
    'public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer)',
    'public.h205f22_a2_browser_supervisor_lease_control_v4(uuid,text,integer)',
    'public.h205f22_a2_browser_supervisor_lease_bootstrap_v3(uuid,text,integer)',
    'public.h205f22_a2_browser_supervisor_complete_v4(uuid,uuid,text,boolean,jsonb,text,boolean)'
  ];
  v_fn text;
begin
  -- E1 RLS stays enabled on both supervisor tables
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'compute_fabric_a2_browser_supervisor_command_h205f22'
      and c.relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'compute_fabric_a2_browser_supervisor_state_h205f22'
      and c.relrowsecurity
  ) then
    raise exception 'canary_rls_not_enabled';
  end if;

  -- E2 partial unique idempotency index exists
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'compute_fabric_a2_browser_supervisor_command_idempotency_uidx'
  ) then
    raise exception 'canary_idempotency_index_missing';
  end if;

  -- E3 v3 widened the action allowlist to include SET_SUPERVISOR_MODE
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.compute_fabric_a2_browser_supervisor_command_h205f22'::regclass
       and conname = 'a2_browser_supervisor_command_action_ck'
       and pg_get_constraintdef(oid) like '%SET_SUPERVISOR_MODE%'
  ) then
    raise exception 'canary_action_constraint_missing_mode';
  end if;

  -- E4 v3 dropped the blanket no-authority constraints (authority is now a
  -- post-completion effect recorded by complete_v4, not a table invariant)
  if exists (
    select 1 from pg_catalog.pg_constraint
     where conname in ('a2_browser_supervisor_command_no_authority_ck',
                       'a2_browser_supervisor_state_no_authority_ck')
  ) then
    raise exception 'canary_no_authority_constraint_still_present';
  end if;

  -- E5 service_role may execute every lane RPC
  foreach v_fn in array v_fns loop
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'canary_service_role_exec_missing (%)', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'canary_public_exec_leak (%)', v_fn;
    end if;
  end loop;

  -- E6 table grants: service_role CRUD, anon/authenticated nothing
  if not has_table_privilege('service_role',
        'public.compute_fabric_a2_browser_supervisor_command_h205f22','SELECT,INSERT,UPDATE')
     or has_table_privilege('anon',
        'public.compute_fabric_a2_browser_supervisor_command_h205f22','SELECT')
     or has_table_privilege('authenticated',
        'public.compute_fabric_a2_browser_supervisor_state_h205f22','SELECT') then
    raise exception 'canary_table_grant_boundary_broken';
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Phase F — live privilege boundary probes (runtime, not catalog claims).
# ---------------------------------------------------------------------------
psql17 <<'SQL' >/tmp/a2-supervisor-service-role.txt
set role service_role;
select public.h205f22_a2_browser_supervisor_enqueue_v3(
  'eeeeeeee-0000-4000-8000-00000000000e'::uuid,
  'POLL',null,'{}'::jsonb,null,300,'CANARY_SVC_ROLE','canary:20260829:svcrole:probe'
)::text;
reset role;
SQL
grep -Eq '"replayed"[[:space:]]*:[[:space:]]*false' /tmp/a2-supervisor-service-role.txt

if psql17 -c "set role anon; select public.h205f22_a2_browser_supervisor_enqueue_v3('eeeeeeee-0000-4000-8000-00000000000e'::uuid,'POLL',null,'{}'::jsonb,null,300,'ANON','canary:20260829:anon:probe');" \
    >/tmp/a2-supervisor-anon.out 2>/tmp/a2-supervisor-anon.err; then
  echo 'anon supervisor RPC unexpectedly succeeded' >&2
  exit 1
fi
grep -Eqi 'permission denied|no permission' /tmp/a2-supervisor-anon.err

if psql17 -c "set role anon; select count(*) from public.compute_fabric_a2_browser_supervisor_command_h205f22;" \
    >/tmp/a2-supervisor-anon-table.out 2>/tmp/a2-supervisor-anon-table.err; then
  echo 'anon supervisor table read unexpectedly succeeded' >&2
  exit 1
fi
grep -Eqi 'permission denied|no permission' /tmp/a2-supervisor-anon-table.err

echo 'A2 browser supervisor control-plane PostgreSQL 17 canary: PASS'
