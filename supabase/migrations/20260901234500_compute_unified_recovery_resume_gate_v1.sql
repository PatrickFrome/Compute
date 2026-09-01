-- Branch-local C0 recovery-resume gate: durable post-successor proof must still agree with fresh native state.
-- Evidence only. This function never grants Browser actuation, retry, wake replay, lease mutation, or promotion authority.
create or replace function public.h205f22_compute_unified_recovery_resume_gate_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_proof_fingerprint_sha256 text,
  p_expected_successor_client_id text,
  p_expected_successor_process_incarnation_id text,
  p_expected_successor_epoch bigint,
  p_expected_source_git_commit text,
  p_max_heartbeat_age interval default interval '120 seconds'
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_durable jsonb;
  v_state record;
  v_checkpoint record;
  v_keepalive jsonb;
  v_observed_process text;
  v_enrolled boolean := false;
  v_ok boolean := false;
  v_reason text := 'UNSET';
  v_now timestamptz := statement_timestamp();
  v_durable_heartbeat timestamptz;
  v_fresh_heartbeat timestamptz;
begin
  if p_workspace_id is null
     or nullif(p_attempt_id,'') is null
     or p_proof_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(p_expected_successor_client_id,'') is null
     or nullif(p_expected_successor_process_incarnation_id,'') is null
     or p_expected_successor_epoch is null or p_expected_successor_epoch < 1
     or p_expected_source_git_commit !~ '^[0-9a-f]{40}$'
     or p_max_heartbeat_age <= interval '0 seconds'
     or p_max_heartbeat_age > interval '10 minutes' then
    return jsonb_build_object(
      'schema','metaengine.compute-unified.recovery-resume-gate.v1',
      'verified',false,'recovery_resume_eligible',false,'reason','INVALID_GATE_INPUT',
      'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
      'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);
  end if;

  begin
    v_durable := public.h205f22_read_compute_unified_post_successor_continuity_v2(
      p_workspace_id,p_attempt_id,p_proof_fingerprint_sha256);
  exception when others then
    return jsonb_build_object(
      'schema','metaengine.compute-unified.recovery-resume-gate.v1',
      'verified',false,'recovery_resume_eligible',false,'reason','DURABLE_PROOF_REJECTED',
      'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
      'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);
  end;

  if not coalesce((v_durable->>'verified')::boolean,false)
     or v_durable->>'reason' is distinct from 'DURABLE_POST_SUCCESSOR_CONTINUITY_VERIFIED'
     or coalesce((v_durable->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_durable->>'restart_authorized')::boolean,true)
     or coalesce((v_durable->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_durable->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_durable->>'authority_effect')::boolean,true) then
    v_reason := 'DURABLE_PROOF_NOT_ZERO_AUTHORITY_VERIFIED';
  elsif v_durable->>'successor_client_id' is distinct from p_expected_successor_client_id
     or v_durable->>'successor_process_incarnation_id' is distinct from p_expected_successor_process_incarnation_id
     or v_durable->>'successor_supervisor_epoch' is distinct from p_expected_successor_epoch::text
     or v_durable->>'expected_source_git_commit' is distinct from p_expected_source_git_commit then
    v_reason := 'DURABLE_PROVENANCE_MISMATCH';
  else
    v_durable_heartbeat := (v_durable->>'heartbeat_observed_at')::timestamptz;
    select s.client_id,s.last_seen_at,s.supervisor_mode,s.armed,s.state
      into v_state
      from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
     where s.client_id=p_expected_successor_client_id and s.workspace_id=p_workspace_id
     limit 1;
    v_fresh_heartbeat := v_state.last_seen_at;

    if v_state.client_id is null then
      v_reason := 'SUCCESSOR_BROWSER_STATE_MISSING';
    elsif v_fresh_heartbeat is null or v_fresh_heartbeat < v_now-p_max_heartbeat_age then
      v_reason := 'SUCCESSOR_HEARTBEAT_STALE';
    elsif v_durable_heartbeat is null or v_fresh_heartbeat < v_durable_heartbeat then
      v_reason := 'SUCCESSOR_HEARTBEAT_REGRESSED';
    else
      v_observed_process := coalesce(
        v_state.state #>> '{perception,process_incarnation_id}',
        v_state.state->>'process_incarnation_id');
      if v_observed_process is distinct from p_expected_successor_process_incarnation_id then
        v_reason := 'SUCCESSOR_PROCESS_MISMATCH';
      elsif v_state.supervisor_mode is distinct from 'CONTROL' or not coalesce(v_state.armed,false) then
        v_reason := 'SUCCESSOR_CONTROL_NOT_ACTIVE';
      else
        v_keepalive := v_state.state #> '{supervisor_lifecycle,keepalive}';
        if v_keepalive is null
           or v_keepalive->>'supervisor_id' is distinct from 'METAENGINE_SUPERVISOR'
           or v_keepalive->>'state' is distinct from 'ACTIVE'
           or v_keepalive->>'supervisor_epoch' is distinct from p_expected_successor_epoch::text then
          v_reason := 'SUCCESSOR_KEEPALIVE_MISMATCH';
        elsif coalesce(v_state.state #>> '{supervisor_lifecycle,supervisor_generation}','UNKNOWN') is distinct from 'IDLE' then
          v_reason := 'SUCCESSOR_GENERATION_NOT_IDLE';
        else
          select exists(
            select 1 from public.compute_fabric_a2_browser_device_h205f22 d
             where d.client_id=p_expected_successor_client_id and d.active=true and d.revoked_at is null
          ) into v_enrolled;
          if not v_enrolled then
            v_reason := 'SUCCESSOR_ENROLLMENT_NOT_ACTIVE';
          else
            select c.architecture_version,c.git_branch,c.git_commit
              into v_checkpoint
              from public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 c
             where c.status='AUTHORITATIVE'
             order by c.created_at desc limit 1;
            if v_checkpoint.architecture_version is null
               or v_checkpoint.git_branch is distinct from 'integration/compute-unified-v1'
               or v_checkpoint.git_commit is distinct from p_expected_source_git_commit then
              v_reason := 'INTEGRATION_HEAD_MISMATCH';
            else
              v_ok := true;
              v_reason := 'RECOVERY_RESUME_EVIDENCE_VERIFIED';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-resume-gate.v1',
    'verified',v_ok,
    'recovery_resume_eligible',v_ok,
    'reason',v_reason,
    'workspace_id',p_workspace_id,
    'attempt_id',p_attempt_id,
    'successor_client_id',p_expected_successor_client_id,
    'successor_process_incarnation_id',p_expected_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_expected_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'durable_proof_fingerprint_sha256',p_proof_fingerprint_sha256,
    'fresh_heartbeat_observed_at',v_fresh_heartbeat,
    'enrollment_active',v_enrolled,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;

revoke all on function public.h205f22_compute_unified_recovery_resume_gate_v1(uuid,text,text,text,text,bigint,text,interval) from public,anon,authenticated;
grant execute on function public.h205f22_compute_unified_recovery_resume_gate_v1(uuid,text,text,text,text,bigint,text,interval) to service_role;
