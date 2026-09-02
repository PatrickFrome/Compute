-- Branch-local C0 recovery admission gate.
-- Durable recovery-resume proof is necessary but not sufficient: re-admit only on fresh exact native state
-- with no active actuation lease or unresolved supervisor command. Evidence only; never grants effect authority.
create or replace function public.h205f22_compute_unified_recovery_admission_gate_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_recovery_resume_fingerprint_sha256 text,
  p_expected_successor_client_id text,
  p_expected_successor_process_incarnation_id text,
  p_expected_successor_epoch bigint,
  p_expected_source_git_commit text,
  p_max_heartbeat_age interval default interval '120 seconds'
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_durable jsonb;
  v_state jsonb;
  v_last_seen timestamptz;
  v_supervisor_mode text;
  v_armed boolean := false;
  v_observed_process text;
  v_checkpoint_branch text;
  v_checkpoint_commit text;
  v_enrolled boolean := false;
  v_active_leases bigint := 0;
  v_unresolved_commands bigint := 0;
  v_ok boolean := false;
  v_reason text := 'UNSET';
  v_now timestamptz := statement_timestamp();
begin
  if p_workspace_id is null
     or nullif(p_attempt_id,'') is null
     or p_recovery_resume_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
     or nullif(p_expected_successor_client_id,'') is null
     or nullif(p_expected_successor_process_incarnation_id,'') is null
     or p_expected_successor_epoch is null or p_expected_successor_epoch < 1
     or p_expected_source_git_commit !~ '^[0-9a-f]{40}$'
     or p_max_heartbeat_age <= interval '0 seconds'
     or p_max_heartbeat_age > interval '10 minutes' then
    v_reason := 'INVALID_GATE_INPUT';
  else
    begin
      v_durable := public.h205f22_read_compute_unified_recovery_resume_proof_v1(
        p_workspace_id,p_attempt_id,p_recovery_resume_fingerprint_sha256);
    exception when others then
      v_reason := 'DURABLE_RECOVERY_PROOF_REJECTED';
    end;

    if v_reason = 'UNSET' then
      if not coalesce((v_durable->>'verified')::boolean,false)
         or v_durable->>'reason' is distinct from 'DURABLE_RECOVERY_RESUME_PROOF_VERIFIED'
         or not coalesce((v_durable->>'recovery_resume_eligible')::boolean,false)
         or coalesce((v_durable->>'automatic_retry_allowed')::boolean,true)
         or coalesce((v_durable->>'restart_authorized')::boolean,true)
         or coalesce((v_durable->>'wake_replay_authorized')::boolean,true)
         or coalesce((v_durable->>'lease_mutation_authorized')::boolean,true)
         or coalesce((v_durable->>'promotion_authorized')::boolean,true)
         or coalesce((v_durable->>'authority_effect')::boolean,true) then
        v_reason := 'DURABLE_RECOVERY_PROOF_NOT_ZERO_AUTHORITY_VERIFIED';
      elsif v_durable->>'successor_client_id' is distinct from p_expected_successor_client_id
         or v_durable->>'successor_process_incarnation_id' is distinct from p_expected_successor_process_incarnation_id
         or v_durable->>'successor_supervisor_epoch' is distinct from p_expected_successor_epoch::text
         or v_durable->>'expected_source_git_commit' is distinct from p_expected_source_git_commit then
        v_reason := 'DURABLE_RECOVERY_PROVENANCE_MISMATCH';
      end if;
    end if;

    if v_reason = 'UNSET' then
      select s.last_seen_at,s.supervisor_mode,s.armed,s.state
        into v_last_seen,v_supervisor_mode,v_armed,v_state
        from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
       where s.workspace_id=p_workspace_id and s.client_id=p_expected_successor_client_id
       limit 1;

      if v_last_seen is null then
        v_reason := 'SUCCESSOR_BROWSER_STATE_MISSING';
      elsif v_last_seen < v_now-p_max_heartbeat_age then
        v_reason := 'SUCCESSOR_HEARTBEAT_STALE';
      else
        v_observed_process := coalesce(
          v_state #>> '{perception,process_incarnation_id}',
          v_state->>'process_incarnation_id');
        if v_observed_process is distinct from p_expected_successor_process_incarnation_id then
          v_reason := 'SUCCESSOR_PROCESS_MISMATCH';
        elsif v_supervisor_mode is distinct from 'CONTROL' or not coalesce(v_armed,false) then
          v_reason := 'SUCCESSOR_CONTROL_NOT_ACTIVE';
        elsif v_state #>> '{supervisor_lifecycle,keepalive,supervisor_id}' is distinct from 'METAENGINE_SUPERVISOR'
           or v_state #>> '{supervisor_lifecycle,keepalive,state}' is distinct from 'ACTIVE'
           or v_state #>> '{supervisor_lifecycle,keepalive,supervisor_epoch}' is distinct from p_expected_successor_epoch::text then
          v_reason := 'SUCCESSOR_KEEPALIVE_MISMATCH';
        elsif coalesce(v_state #>> '{supervisor_lifecycle,supervisor_generation}','UNKNOWN') is distinct from 'IDLE' then
          v_reason := 'SUCCESSOR_GENERATION_NOT_IDLE';
        end if;
      end if;
    end if;

    if v_reason = 'UNSET' then
      select exists(
        select 1 from public.compute_fabric_a2_browser_device_h205f22 d
         where d.client_id=p_expected_successor_client_id and d.active=true and d.revoked_at is null
      ) into v_enrolled;
      if not v_enrolled then v_reason := 'SUCCESSOR_ENROLLMENT_NOT_ACTIVE'; end if;
    end if;

    if v_reason = 'UNSET' then
      select c.git_branch,c.git_commit into v_checkpoint_branch,v_checkpoint_commit
        from public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 c
       where c.status='AUTHORITATIVE' order by c.created_at desc limit 1;
      if v_checkpoint_branch is distinct from 'integration/compute-unified-v1'
         or v_checkpoint_commit is distinct from p_expected_source_git_commit then
        v_reason := 'INTEGRATION_HEAD_MISMATCH';
      end if;
    end if;

    if v_reason = 'UNSET' then
      select count(*) into v_active_leases
        from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
       where l.workspace_id=p_workspace_id and l.status='ACTIVE' and l.expires_at>v_now;
      if v_active_leases <> 0 then v_reason := 'ACTIVE_ACTUATION_LEASE_PRESENT'; end if;
    end if;

    if v_reason = 'UNSET' then
      select count(*) into v_unresolved_commands
        from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
       where c.workspace_id=p_workspace_id
         and (c.target_client_id is null or c.target_client_id=p_expected_successor_client_id)
         and c.status in ('PENDING','LEASED') and c.expires_at>v_now;
      if v_unresolved_commands <> 0 then v_reason := 'UNRESOLVED_SUPERVISOR_COMMAND_PRESENT'; end if;
    end if;

    if v_reason = 'UNSET' then
      v_ok := true;
      v_reason := 'RECOVERY_ADMISSION_EVIDENCE_VERIFIED';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-admission-gate.v1',
    'verified',v_ok,
    'recovery_admission_eligible',v_ok,
    'reason',v_reason,
    'workspace_id',p_workspace_id,
    'attempt_id',p_attempt_id,
    'successor_client_id',p_expected_successor_client_id,
    'successor_process_incarnation_id',p_expected_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_expected_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'recovery_resume_fingerprint_sha256',p_recovery_resume_fingerprint_sha256,
    'fresh_heartbeat_observed_at',v_last_seen,
    'enrollment_active',v_enrolled,
    'active_actuation_lease_count',v_active_leases,
    'unresolved_supervisor_command_count',v_unresolved_commands,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;

revoke all on function public.h205f22_compute_unified_recovery_admission_gate_v1(uuid,text,text,text,text,bigint,text,interval) from public,anon,authenticated;
grant execute on function public.h205f22_compute_unified_recovery_admission_gate_v1(uuid,text,text,text,text,bigint,text,interval) to service_role;
