\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;
\ir ../../../supabase/migrations/20260831205000_compute_unified_supervisor_rollover_decision_v1.sql

DO $$
DECLARE
  v jsonb;
BEGIN
  v := public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb_build_object(
    'authority_effect', false,
    'browser_supervisor', jsonb_build_object('stale', true, 'runtime', jsonb_build_object(
      'supervisor_generation', 'IDLE', 'quiescent', true,
      'keepalive', jsonb_build_object(), 'self_update', jsonb_build_object('restart_gate_safe', false)
    )),
    'actuation_leases', jsonb_build_object('active_unreleased_count', 0)
  ));
  if v->>'state' <> 'ROLLOVER_READY' then raise exception 'expected ROLLOVER_READY: %', v; end if;
  if (v->>'restart_authorized')::boolean then raise exception 'rollover decision must never authorize restart'; end if;

  v := public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb_build_object(
    'authority_effect', false,
    'browser_supervisor', jsonb_build_object('stale', true, 'runtime', jsonb_build_object(
      'supervisor_generation', 'IDLE', 'quiescent', false,
      'keepalive', jsonb_build_object('active_wake_id', 'wake-ambiguous')
    )),
    'actuation_leases', jsonb_build_object('active_unreleased_count', 0)
  ));
  if v->>'state' <> 'RECOVERING' then raise exception 'expected RECOVERING: %', v; end if;
  if not (v->'blockers' ? 'NOT_QUIESCENT') or not (v->'blockers' ? 'ACTIVE_WAKE_PRESENT') then raise exception 'missing blockers: %', v; end if;

  v := public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb_build_object(
    'authority_effect', false,
    'browser_supervisor', jsonb_build_object('stale', false, 'runtime', jsonb_build_object(
      'supervisor_generation', 'GENERATING', 'quiescent', false,
      'keepalive', jsonb_build_object('pending_wake_id', 'wake-next')
    )),
    'actuation_leases', jsonb_build_object('active_unreleased_count', 1)
  ));
  if v->>'state' <> 'WAITING' then raise exception 'expected WAITING: %', v; end if;
  if (v->>'authority_effect')::boolean or (v->>'wake_replay_authorized')::boolean or (v->>'lease_mutation_authorized')::boolean then
    raise exception 'decision leaked authority: %', v;
  end if;

  begin
    perform public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb_build_object('authority_effect', true));
    raise exception 'authority-bearing snapshot should have been rejected';
  exception when sqlstate '22023' then null;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon', 'public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb)', 'EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated', 'public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb)', 'EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role', 'public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb)', 'EXECUTE') then raise exception 'service_role execute missing'; end if;
END $$;
