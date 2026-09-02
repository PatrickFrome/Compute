-- Branch-local C0 hardening: compose durable recovery-admission readback with
-- typed restart-actuator preconditions without granting restart authority.

create or replace function public.h205f22_compute_unified_recovery_restart_precondition_v1(
  p_recovery_admission_readback jsonb,
  p_restart_readback jsonb,
  p_actuator_evidence jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_restart_precondition jsonb;
  v_workspace text;
  v_client text;
  v_process text;
  v_epoch bigint;
  v_source_commit text;
begin
  if p_recovery_admission_readback is null or p_restart_readback is null or p_actuator_evidence is null then
    raise exception 'recovery/restart precondition evidence required';
  end if;

  if p_recovery_admission_readback->>'schema' is distinct from 'metaengine.compute-unified.recovery-admission-readback.v1'
     or not coalesce((p_recovery_admission_readback->>'verified')::boolean,false)
     or p_recovery_admission_readback->>'reason' is distinct from 'RECOVERY_ADMISSION_DURABLE_PROOF_VERIFIED'
     or not coalesce((p_recovery_admission_readback->>'recovery_admission_eligible')::boolean,false)
     or not coalesce((p_recovery_admission_readback->>'enrollment_active')::boolean,false)
     or coalesce((p_recovery_admission_readback->>'active_actuation_lease_count')::bigint,-1) <> 0
     or coalesce((p_recovery_admission_readback->>'unresolved_supervisor_command_count')::bigint,-1) <> 0
     or coalesce((p_recovery_admission_readback->>'automatic_retry_allowed')::boolean,true)
     or coalesce((p_recovery_admission_readback->>'restart_authorized')::boolean,true)
     or coalesce((p_recovery_admission_readback->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_recovery_admission_readback->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_recovery_admission_readback->>'promotion_authorized')::boolean,true)
     or coalesce((p_recovery_admission_readback->>'authority_effect')::boolean,true) then
    raise exception 'recovery admission evidence rejected';
  end if;

  v_restart_precondition := public.h205f22_compute_unified_restart_actuator_precondition_v1(
    p_restart_readback,
    p_actuator_evidence
  );

  if not coalesce((v_restart_precondition->>'preconditions_verified')::boolean,false)
     or coalesce((v_restart_precondition->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((v_restart_precondition->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((v_restart_precondition->>'post_effect_readback_required')::boolean,false)
     or coalesce((v_restart_precondition->>'restart_authorized')::boolean,true)
     or coalesce((v_restart_precondition->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_restart_precondition->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_restart_precondition->>'authority_effect')::boolean,true) then
    raise exception 'restart actuator precondition rejected';
  end if;

  v_workspace := p_recovery_admission_readback->>'workspace_id';
  v_client := p_recovery_admission_readback->>'successor_client_id';
  v_process := p_recovery_admission_readback->>'successor_process_incarnation_id';
  v_epoch := (p_recovery_admission_readback->>'successor_supervisor_epoch')::bigint;
  v_source_commit := p_recovery_admission_readback->>'expected_source_git_commit';

  if v_workspace is null or v_client is null or v_process is null or v_epoch is null
     or v_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'recovery admission provenance incomplete';
  end if;

  if v_restart_precondition->>'workspace_id' is distinct from v_workspace
     or v_restart_precondition->>'target_client_id' is distinct from v_client
     or v_restart_precondition->>'target_process_incarnation_id' is distinct from v_process
     or (v_restart_precondition->>'supervisor_epoch')::bigint is distinct from v_epoch
     or v_restart_precondition->>'expected_source_git_commit' is distinct from v_source_commit then
    raise exception 'recovery admission/restart provenance mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-precondition.v1',
    'preconditions_verified',true,
    'reason','RECOVERY_AND_TYPED_RESTART_PRECONDITIONS_VERIFIED',
    'workspace_id',v_workspace,
    'recovery_attempt_id',p_recovery_admission_readback->>'attempt_id',
    'recovery_admission_fingerprint_sha256',p_recovery_admission_readback->>'recovery_admission_fingerprint_sha256',
    'restart_intent_id',v_restart_precondition->>'restart_intent_id',
    'lease_id',v_restart_precondition->>'lease_id',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_scope','BROWSER_RESTART',
    'target_client_id',v_client,
    'target_process_incarnation_id',v_process,
    'supervisor_epoch',v_epoch,
    'expected_source_git_commit',v_source_commit,
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_recovery_restart_precondition_v1(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_recovery_restart_precondition_v1(jsonb,jsonb,jsonb) to service_role;
