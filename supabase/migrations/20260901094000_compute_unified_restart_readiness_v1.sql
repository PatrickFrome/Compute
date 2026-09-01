-- Branch-local C0 continuity hardening: compose successor identity/readback with
-- one stable rollover snapshot and self-update/quiescence gates. This function
-- is read-only and never authorizes the restart effect itself.

create or replace function public.h205f22_compute_unified_restart_readiness_v1(
  p_workspace uuid,
  p_checkpoint_id bigint,
  p_successor_client_id text,
  p_successor_process_incarnation_id text,
  p_successor_epoch bigint,
  p_expected_source_git_commit text,
  p_max_heartbeat_age interval default interval '2 minutes'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_successor jsonb;
  v_rollover jsonb;
  v_browser jsonb;
  v_runtime jsonb;
  v_keepalive jsonb;
  v_self_update jsonb;
  v_leases integer := 0;
  v_ready boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  v_successor := public.h205f22_compute_unified_successor_readback_v1(
    p_workspace,
    p_checkpoint_id,
    p_successor_client_id,
    p_successor_process_incarnation_id,
    p_successor_epoch,
    p_expected_source_git_commit,
    p_max_heartbeat_age
  );

  v_rollover := public.h205f22_compute_unified_rollover_read_v1(p_workspace);
  v_browser := coalesce(v_rollover->'browser_supervisor','{}'::jsonb);
  v_runtime := coalesce(v_browser->'runtime','{}'::jsonb);
  v_keepalive := coalesce(v_runtime->'keepalive','{}'::jsonb);
  v_self_update := coalesce(v_runtime->'self_update','{}'::jsonb);
  v_leases := coalesce((v_rollover#>>'{actuation_leases,active_unreleased_count}')::integer,0);

  if not coalesce((v_successor->>'verified')::boolean,false) then
    v_blockers := v_blockers || jsonb_build_array('SUCCESSOR_READBACK_NOT_VERIFIED');
  end if;
  if v_browser->>'client_id' is distinct from p_successor_client_id then
    v_blockers := v_blockers || jsonb_build_array('SUCCESSOR_CLIENT_NOT_CURRENT');
  end if;
  if v_runtime->>'process_incarnation_id' is distinct from p_successor_process_incarnation_id then
    v_blockers := v_blockers || jsonb_build_array('SUCCESSOR_PROCESS_NOT_CURRENT');
  end if;
  if coalesce((v_browser->>'stale')::boolean,true) then
    v_blockers := v_blockers || jsonb_build_array('BROWSER_STALE');
  end if;
  if v_leases <> 0 then
    v_blockers := v_blockers || jsonb_build_array('ACTIVE_ACTUATION_LEASE');
  end if;
  if coalesce(v_runtime->>'supervisor_generation','UNKNOWN') <> 'IDLE' then
    v_blockers := v_blockers || jsonb_build_array('SUPERVISOR_GENERATION_NOT_IDLE');
  end if;
  if not coalesce((v_runtime->>'quiescent')::boolean,false) then
    v_blockers := v_blockers || jsonb_build_array('NOT_QUIESCENT');
  end if;
  if nullif(v_keepalive->>'active_wake_id','') is not null then
    v_blockers := v_blockers || jsonb_build_array('ACTIVE_WAKE_PRESENT');
  end if;
  if nullif(v_keepalive->>'pending_wake_id','') is not null then
    v_blockers := v_blockers || jsonb_build_array('PENDING_WAKE_PRESENT');
  end if;
  if coalesce((v_keepalive->>'queued_wake_count')::integer,0) <> 0 then
    v_blockers := v_blockers || jsonb_build_array('QUEUED_WAKE_PRESENT');
  end if;
  if coalesce(v_self_update->>'state','UNKNOWN') <> 'CURRENT' then
    v_blockers := v_blockers || jsonb_build_array('SELF_UPDATE_NOT_CURRENT');
  end if;
  if nullif(v_self_update->>'trusted_channel','') is null then
    v_blockers := v_blockers || jsonb_build_array('TRUSTED_UPDATE_CHANNEL_MISSING');
  end if;
  if not coalesce((v_self_update->>'restart_gate_safe')::boolean,false) then
    v_blockers := v_blockers || jsonb_build_array('SELF_UPDATE_RESTART_GATE_UNSAFE');
  end if;

  v_ready := jsonb_array_length(v_blockers)=0;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-readiness.v1',
    'workspace_id',p_workspace,
    'checkpoint_id',p_checkpoint_id,
    'successor_client_id',p_successor_client_id,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'restart_ready',v_ready,
    'state',case when v_ready then 'ROLLOVER' else 'RECOVERING' end,
    'blockers',v_blockers,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval) to service_role;