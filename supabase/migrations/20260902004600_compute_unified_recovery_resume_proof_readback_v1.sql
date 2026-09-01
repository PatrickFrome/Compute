-- Branch-local C0 hardening: exact readback verification for durable recovery-resume proof.
create or replace function public.h205f22_read_compute_unified_recovery_resume_proof_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_recovery_resume_fingerprint_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_row public.compute_unified_recovery_resume_proof_h205f22%rowtype;
  v_recomputed text;
  v_e jsonb;
begin
  if p_workspace_id is null or nullif(p_attempt_id,'') is null
     or p_recovery_resume_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'recovery-resume readback identity incomplete';
  end if;

  select * into v_row
    from public.compute_unified_recovery_resume_proof_h205f22
   where workspace_id=p_workspace_id
     and attempt_id=p_attempt_id
     and recovery_resume_fingerprint_sha256=p_recovery_resume_fingerprint_sha256;
  if v_row.recovery_resume_proof_id is null then
    raise exception 'recovery-resume durable proof not found';
  end if;

  v_e := v_row.verified_evidence;
  v_recomputed := encode(public.digest(convert_to(v_e::text,'UTF8'),'sha256'),'hex');

  if v_recomputed is distinct from v_row.recovery_resume_fingerprint_sha256
     or v_e->>'schema' is distinct from 'metaengine.compute-unified.recovery-resume-gate.v1'
     or not coalesce((v_e->>'verified')::boolean,false)
     or not coalesce((v_e->>'recovery_resume_eligible')::boolean,false)
     or v_e->>'reason' is distinct from 'RECOVERY_RESUME_EVIDENCE_VERIFIED'
     or (v_e->>'workspace_id')::uuid is distinct from v_row.workspace_id
     or v_e->>'attempt_id' is distinct from v_row.attempt_id
     or v_e->>'successor_client_id' is distinct from v_row.successor_client_id
     or v_e->>'successor_process_incarnation_id' is distinct from v_row.successor_process_incarnation_id
     or (v_e->>'successor_supervisor_epoch')::bigint is distinct from v_row.successor_supervisor_epoch
     or v_e->>'expected_source_git_commit' is distinct from v_row.expected_source_git_commit
     or v_e->>'durable_proof_fingerprint_sha256' is distinct from v_row.durable_proof_fingerprint_sha256
     or (v_e->>'fresh_heartbeat_observed_at')::timestamptz is distinct from v_row.fresh_heartbeat_observed_at
     or v_row.automatic_retry_allowed or v_row.restart_authorized or v_row.wake_replay_authorized
     or v_row.lease_mutation_authorized or v_row.promotion_authorized or v_row.authority_effect
     or coalesce((v_e->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_e->>'restart_authorized')::boolean,true)
     or coalesce((v_e->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_e->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_e->>'promotion_authorized')::boolean,true)
     or coalesce((v_e->>'authority_effect')::boolean,true) then
    raise exception 'recovery-resume durable proof verification failed';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-resume-readback.v1',
    'verified',true,
    'reason','DURABLE_RECOVERY_RESUME_PROOF_VERIFIED',
    'workspace_id',v_row.workspace_id,
    'attempt_id',v_row.attempt_id,
    'successor_client_id',v_row.successor_client_id,
    'successor_process_incarnation_id',v_row.successor_process_incarnation_id,
    'successor_supervisor_epoch',v_row.successor_supervisor_epoch,
    'expected_source_git_commit',v_row.expected_source_git_commit,
    'durable_proof_fingerprint_sha256',v_row.durable_proof_fingerprint_sha256,
    'fresh_heartbeat_observed_at',v_row.fresh_heartbeat_observed_at,
    'recovery_resume_fingerprint_sha256',v_row.recovery_resume_fingerprint_sha256,
    'recovery_resume_eligible',true,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;
revoke all on function public.h205f22_read_compute_unified_recovery_resume_proof_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_read_compute_unified_recovery_resume_proof_v1(uuid,text,text) to service_role;
