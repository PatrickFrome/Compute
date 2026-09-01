-- Branch-local C0 continuity hardening: verify that an already-accepted successor
-- identity has fresh Browser heartbeat and exact active enrollment readback.
-- This function is read-only and never grants restart, wake replay, lease mutation,
-- Browser actuation, promotion, or retry authority.

create or replace function public.h205f22_compute_unified_successor_readback_v1(
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
  v_accept jsonb;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_process text;
  v_device_id uuid;
  v_now timestamptz := statement_timestamp();
  v_verified boolean := false;
  v_reason text := 'UNSET';
begin
  if p_max_heartbeat_age is null or p_max_heartbeat_age <= interval '0 seconds' or p_max_heartbeat_age > interval '10 minutes' then
    return jsonb_build_object('schema','metaengine.compute-unified.successor-readback.v1','verified',false,'reason','HEARTBEAT_AGE_BOUND_INVALID','authority_effect',false,'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false);
  end if;

  v_accept := public.h205f22_compute_unified_successor_acceptance_v1(
    p_workspace,p_checkpoint_id,p_successor_process_incarnation_id,p_successor_epoch,p_expected_source_git_commit
  );
  if not coalesce((v_accept->>'accepted')::boolean,false) then
    return jsonb_build_object('schema','metaengine.compute-unified.successor-readback.v1','verified',false,'reason','SUCCESSOR_ACCEPTANCE_FAILED','acceptance',v_accept,'authority_effect',false,'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false);
  end if;

  select * into v_state
  from public.compute_fabric_a2_browser_supervisor_state_h205f22
  where workspace_id=p_workspace and client_id=p_successor_client_id
  order by last_seen_at desc
  limit 1;

  if not found then
    v_reason := 'SUCCESSOR_HEARTBEAT_MISSING';
  else
    v_process := coalesce(v_state.state->>'process_incarnation_id',v_state.state#>>'{perception,process_incarnation_id}');
    if v_process is distinct from p_successor_process_incarnation_id then
      v_reason := 'SUCCESSOR_PROCESS_INCARNATION_MISMATCH';
    elsif v_state.last_seen_at is null or v_state.last_seen_at < v_now - p_max_heartbeat_age or v_state.last_seen_at > v_now + interval '30 seconds' then
      v_reason := 'SUCCESSOR_HEARTBEAT_NOT_FRESH';
    elsif not coalesce(v_state.armed,false) or v_state.supervisor_mode is distinct from 'CONTROL' then
      v_reason := 'SUCCESSOR_CONTROL_STATE_NOT_READY';
    else
      select d.device_id into v_device_id
      from public.compute_fabric_a2_browser_device_h205f22 d
      where d.client_id=p_successor_client_id
        and d.active is true
        and d.revoked_at is null
      order by d.enrolled_at desc
      limit 1;
      if not found then
        v_reason := 'SUCCESSOR_ENROLLMENT_NOT_ACTIVE';
      else
        v_verified := true;
        v_reason := 'SUCCESSOR_READBACK_VERIFIED';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.successor-readback.v1',
    'workspace_id',p_workspace,
    'checkpoint_id',p_checkpoint_id,
    'successor_client_id',p_successor_client_id,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'heartbeat_observed_at',v_state.last_seen_at,
    'enrolled_device_id',v_device_id,
    'verified',v_verified,
    'reason',v_reason,
    'requires_quiescent_restart_gate',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval) to service_role;
