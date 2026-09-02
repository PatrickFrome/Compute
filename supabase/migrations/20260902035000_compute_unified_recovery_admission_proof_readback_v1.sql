-- Branch-local C0 hardening: verify durable recovery-admission proof without granting authority.
create extension if not exists pgcrypto;

create or replace function public.h205f22_verify_compute_unified_recovery_admission_proof_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_recovery_admission_fingerprint_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v public.compute_unified_recovery_admission_proof_h205f22%rowtype;
  v_fp text;
  v_e jsonb;
begin
  if p_workspace_id is null or nullif(p_attempt_id,'') is null
     or p_recovery_admission_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'recovery-admission readback identity/fingerprint invalid';
  end if;

  select * into v
    from public.compute_unified_recovery_admission_proof_h205f22
   where workspace_id=p_workspace_id
     and attempt_id=p_attempt_id
     and recovery_admission_fingerprint_sha256=p_recovery_admission_fingerprint_sha256;

  if v.recovery_admission_proof_id is null then
    raise exception 'recovery-admission durable proof not found';
  end if;

  v_e := v.verified_evidence;
  v_fp := encode(public.digest(convert_to(v_e::text,'UTF8'),'sha256'),'hex');

  if v_fp is distinct from v.recovery_admission_fingerprint_sha256
     or v_fp is distinct from p_recovery_admission_fingerprint_sha256
     or v_e->>'schema' is distinct from 'metaengine.compute-unified.recovery-admission-gate.v1'
     or not coalesce((v_e->>'verified')::boolean,false)
     or not coalesce((v_e->>'recovery_admission_eligible')::boolean,false)
     or v_e->>'reason' is distinct from 'RECOVERY_ADMISSION_EVIDENCE_VERIFIED'
     or (v_e->>'workspace_id')::uuid is distinct from v.workspace_id
     or v_e->>'attempt_id' is distinct from v.attempt_id
     or v_e->>'successor_client_id' is distinct from v.successor_client_id
     or v_e->>'successor_process_incarnation_id' is distinct from v.successor_process_incarnation_id
     or (v_e->>'successor_supervisor_epoch')::bigint is distinct from v.successor_supervisor_epoch
     or v_e->>'expected_source_git_commit' is distinct from v.expected_source_git_commit
     or v_e->>'recovery_resume_fingerprint_sha256' is distinct from v.recovery_resume_fingerprint_sha256
     or (v_e->>'fresh_heartbeat_observed_at')::timestamptz is distinct from v.fresh_heartbeat_observed_at
     or coalesce((v_e->>'enrollment_active')::boolean,false) is distinct from v.enrollment_active
     or coalesce((v_e->>'active_actuation_lease_count')::bigint,-1) is distinct from v.active_actuation_lease_count
     or coalesce((v_e->>'unresolved_supervisor_command_count')::bigint,-1) is distinct from v.unresolved_supervisor_command_count
     or not v.enrollment_active
     or v.active_actuation_lease_count <> 0
     or v.unresolved_supervisor_command_count <> 0
     or v.automatic_retry_allowed
     or v.restart_authorized
     or v.wake_replay_authorized
     or v.lease_mutation_authorized
     or v.promotion_authorized
     or v.authority_effect
     or coalesce((v_e->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_e->>'restart_authorized')::boolean,true)
     or coalesce((v_e->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_e->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_e->>'promotion_authorized')::boolean,true)
     or coalesce((v_e->>'authority_effect')::boolean,true) then
    raise exception 'recovery-admission durable proof integrity/provenance verification failed';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-admission-readback.v1',
    'verified',true,
    'reason','RECOVERY_ADMISSION_DURABLE_PROOF_VERIFIED',
    'workspace_id',v.workspace_id,
    'attempt_id',v.attempt_id,
    'successor_client_id',v.successor_client_id,
    'successor_process_incarnation_id',v.successor_process_incarnation_id,
    'successor_supervisor_epoch',v.successor_supervisor_epoch,
    'expected_source_git_commit',v.expected_source_git_commit,
    'recovery_resume_fingerprint_sha256',v.recovery_resume_fingerprint_sha256,
    'recovery_admission_fingerprint_sha256',v.recovery_admission_fingerprint_sha256,
    'fresh_heartbeat_observed_at',v.fresh_heartbeat_observed_at,
    'enrollment_active',v.enrollment_active,
    'active_actuation_lease_count',v.active_actuation_lease_count,
    'unresolved_supervisor_command_count',v.unresolved_supervisor_command_count,
    'recovery_admission_eligible',true,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;

revoke all on function public.h205f22_verify_compute_unified_recovery_admission_proof_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_verify_compute_unified_recovery_admission_proof_v1(uuid,text,text) to service_role;
