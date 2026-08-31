create or replace function public.h205f22_compute_unified_supervisor_rollover_decision_v1(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_browser jsonb := coalesce(p_snapshot->'browser_supervisor', '{}'::jsonb);
  v_runtime jsonb := coalesce(v_browser->'runtime', '{}'::jsonb);
  v_keepalive jsonb := coalesce(v_runtime->'keepalive', '{}'::jsonb);
  v_self_update jsonb := coalesce(v_runtime->'self_update', '{}'::jsonb);
  v_leases jsonb := coalesce(p_snapshot->'actuation_leases', '{}'::jsonb);
  v_present boolean := coalesce((v_browser->>'present')::boolean, true);
  v_stale boolean := coalesce((v_browser->>'stale')::boolean, true);
  v_active_leases integer := coalesce((v_leases->>'active_unreleased_count')::integer, 0);
  v_generation text := coalesce(v_runtime->>'supervisor_generation', 'UNKNOWN');
  v_quiescent boolean := coalesce((v_runtime->>'quiescent')::boolean, false);
  v_active_wake text := nullif(v_keepalive->>'active_wake_id', '');
  v_pending_wake text := nullif(v_keepalive->>'pending_wake_id', '');
  v_state text;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_snapshot is null then
    raise exception 'snapshot required' using errcode = '22023';
  end if;

  if coalesce((p_snapshot->>'authority_effect')::boolean, false) then
    raise exception 'authority-bearing snapshot rejected' using errcode = '22023';
  end if;

  if v_active_leases > 0 then
    v_blockers := v_blockers || jsonb_build_array('ACTIVE_ACTUATION_LEASE');
  end if;
  if v_generation <> 'IDLE' then
    v_blockers := v_blockers || jsonb_build_array('SUPERVISOR_GENERATION_NOT_IDLE');
  end if;
  if not v_quiescent then
    v_blockers := v_blockers || jsonb_build_array('NOT_QUIESCENT');
  end if;
  if v_active_wake is not null then
    v_blockers := v_blockers || jsonb_build_array('ACTIVE_WAKE_PRESENT');
  end if;
  if v_pending_wake is not null then
    v_blockers := v_blockers || jsonb_build_array('PENDING_WAKE_PRESENT');
  end if;

  if not v_present or v_stale then
    if jsonb_array_length(v_blockers) = 0 then
      v_state := 'ROLLOVER_READY';
    else
      v_state := 'RECOVERING';
    end if;
  else
    v_state := case when jsonb_array_length(v_blockers) = 0 then 'ACTIVE' else 'WAITING' end;
  end if;

  return jsonb_build_object(
    'schema', 'metaengine.compute-unified.supervisor-rollover-decision.v1',
    'state', v_state,
    'browser_present', v_present,
    'browser_stale', v_stale,
    'active_unreleased_leases', v_active_leases,
    'supervisor_generation', v_generation,
    'quiescent', v_quiescent,
    'active_wake_present', v_active_wake is not null,
    'pending_wake_present', v_pending_wake is not null,
    'blockers', v_blockers,
    'restart_authorized', false,
    'wake_replay_authorized', false,
    'lease_mutation_authorized', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb) from public;
revoke all on function public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb) from anon;
revoke all on function public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb) from authenticated;
grant execute on function public.h205f22_compute_unified_supervisor_rollover_decision_v1(jsonb) to service_role;
