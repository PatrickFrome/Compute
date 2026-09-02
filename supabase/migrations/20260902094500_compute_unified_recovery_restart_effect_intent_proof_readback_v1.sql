-- Branch-local C0 hardening: verify durable restart-effect intent proof without granting authority.
create extension if not exists pgcrypto;

create or replace function public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(
  p_workspace_id uuid,
  p_recovery_attempt_id text,
  p_restart_intent_id text,
  p_recovery_restart_effect_intent_fingerprint_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v public.compute_unified_recovery_restart_effect_intent_proof_h205f22%rowtype;
  v_fp text;
  v_e jsonb;
begin
  if p_workspace_id is null or nullif(p_recovery_attempt_id,'') is null or nullif(p_restart_intent_id,'') is null
     or p_recovery_restart_effect_intent_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'restart effect intent readback identity/fingerprint invalid';
  end if;

  select * into v
    from public.compute_unified_recovery_restart_effect_intent_proof_h205f22
   where workspace_id=p_workspace_id
     and recovery_attempt_id=p_recovery_attempt_id
     and restart_intent_id=p_restart_intent_id
     and recovery_restart_effect_intent_fingerprint_sha256=p_recovery_restart_effect_intent_fingerprint_sha256;

  if v.recovery_restart_effect_intent_proof_id is null then
    raise exception 'restart effect intent durable proof not found';
  end if;

  v_e := v.verified_evidence;
  v_fp := encode(public.digest(convert_to(v_e::text,'UTF8'),'sha256'),'hex');

  if v_fp is distinct from v.recovery_restart_effect_intent_fingerprint_sha256
     or v_fp is distinct from p_recovery_restart_effect_intent_fingerprint_sha256
     or v_e->>'schema' is distinct from 'metaengine.compute-unified.recovery-restart-effect-intent.v1'
     or not coalesce((v_e->>'intent_bound')::boolean,false)
     or v_e->>'reason' is distinct from 'DURABLE_RECOVERY_RESTART_EFFECT_INTENT_BOUND'
     or (v_e->>'workspace_id')::uuid is distinct from v.workspace_id
     or v_e->>'recovery_attempt_id' is distinct from v.recovery_attempt_id
     or v_e->>'restart_intent_id' is distinct from v.restart_intent_id
     or v_e->>'lease_id' is distinct from v.lease_id
     or v_e->>'actuator_type' is distinct from v.actuator_type
     or v_e->>'effect_scope' is distinct from v.effect_scope
     or v_e->>'target_client_id' is distinct from v.target_client_id
     or v_e->>'target_process_incarnation_id' is distinct from v.target_process_incarnation_id
     or (v_e->>'supervisor_epoch')::bigint is distinct from v.supervisor_epoch
     or v_e->>'expected_source_git_commit' is distinct from v.expected_source_git_commit
     or v_e->>'recovery_restart_precondition_fingerprint_sha256' is distinct from v.recovery_restart_precondition_fingerprint_sha256
     or v.automatic_retry_allowed
     or not v.effect_must_be_single_shot
     or not v.post_effect_readback_required
     or v.restart_authorized
     or v.wake_replay_authorized
     or v.lease_mutation_authorized
     or v.promotion_authorized
     or v.authority_effect
     or coalesce((v_e->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((v_e->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((v_e->>'post_effect_readback_required')::boolean,false)
     or coalesce((v_e->>'restart_authorized')::boolean,true)
     or coalesce((v_e->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_e->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_e->>'promotion_authorized')::boolean,true)
     or coalesce((v_e->>'authority_effect')::boolean,true) then
    raise exception 'restart effect intent durable proof integrity/provenance verification failed';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-effect-intent-readback.v1',
    'verified',true,
    'reason','RECOVERY_RESTART_EFFECT_INTENT_DURABLE_PROOF_VERIFIED',
    'workspace_id',v.workspace_id,
    'recovery_attempt_id',v.recovery_attempt_id,
    'restart_intent_id',v.restart_intent_id,
    'lease_id',v.lease_id,
    'actuator_type',v.actuator_type,
    'effect_scope',v.effect_scope,
    'target_client_id',v.target_client_id,
    'target_process_incarnation_id',v.target_process_incarnation_id,
    'supervisor_epoch',v.supervisor_epoch,
    'expected_source_git_commit',v.expected_source_git_commit,
    'recovery_restart_precondition_fingerprint_sha256',v.recovery_restart_precondition_fingerprint_sha256,
    'recovery_restart_effect_intent_fingerprint_sha256',v.recovery_restart_effect_intent_fingerprint_sha256,
    'intent_bound',true,
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;

revoke all on function public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(uuid,text,text,text) to service_role;
