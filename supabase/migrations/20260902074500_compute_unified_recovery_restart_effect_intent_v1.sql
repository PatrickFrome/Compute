-- Branch-local C0 hardening: bind a verified durable recovery/restart proof to an exact
-- single-shot restart effect intent without granting restart authority.
create or replace function public.h205f22_compute_unified_recovery_restart_effect_intent_v1(
  p_recovery_restart_readback jsonb,
  p_effect_intent jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_workspace text;
  v_attempt text;
  v_restart_intent text;
  v_lease text;
  v_client text;
  v_process text;
  v_epoch bigint;
  v_source text;
begin
  if p_recovery_restart_readback is null or p_effect_intent is null then
    raise exception 'recovery restart readback and effect intent required';
  end if;

  if p_recovery_restart_readback->>'schema' is distinct from 'metaengine.compute-unified.recovery-restart-precondition-readback.v1'
     or not coalesce((p_recovery_restart_readback->>'verified')::boolean,false)
     or p_recovery_restart_readback->>'reason' is distinct from 'RECOVERY_RESTART_PRECONDITION_DURABLE_PROOF_VERIFIED'
     or not coalesce((p_recovery_restart_readback->>'preconditions_verified')::boolean,false)
     or coalesce((p_recovery_restart_readback->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_recovery_restart_readback->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_recovery_restart_readback->>'post_effect_readback_required')::boolean,false)
     or coalesce((p_recovery_restart_readback->>'restart_authorized')::boolean,true)
     or coalesce((p_recovery_restart_readback->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_recovery_restart_readback->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_recovery_restart_readback->>'promotion_authorized')::boolean,true)
     or coalesce((p_recovery_restart_readback->>'authority_effect')::boolean,true) then
    raise exception 'durable recovery/restart readback rejected';
  end if;

  if p_effect_intent->>'schema' is distinct from 'metaengine.compute-unified.restart-effect-intent.v1'
     or p_effect_intent->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or p_effect_intent->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or coalesce((p_effect_intent->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_effect_intent->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_effect_intent->>'post_effect_readback_required')::boolean,false)
     or coalesce((p_effect_intent->>'restart_authorized')::boolean,true)
     or coalesce((p_effect_intent->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_effect_intent->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_effect_intent->>'promotion_authorized')::boolean,true)
     or coalesce((p_effect_intent->>'authority_effect')::boolean,true) then
    raise exception 'restart effect intent rejected';
  end if;

  v_workspace := p_recovery_restart_readback->>'workspace_id';
  v_attempt := p_recovery_restart_readback->>'recovery_attempt_id';
  v_restart_intent := p_recovery_restart_readback->>'restart_intent_id';
  v_lease := p_recovery_restart_readback->>'lease_id';
  v_client := p_recovery_restart_readback->>'target_client_id';
  v_process := p_recovery_restart_readback->>'target_process_incarnation_id';
  v_epoch := (p_recovery_restart_readback->>'supervisor_epoch')::bigint;
  v_source := p_recovery_restart_readback->>'expected_source_git_commit';

  if v_workspace is null or v_attempt is null or v_restart_intent is null or v_lease is null
     or v_client is null or v_process is null or v_epoch is null or v_source !~ '^[0-9a-f]{40}$' then
    raise exception 'recovery/restart provenance incomplete';
  end if;

  if p_effect_intent->>'workspace_id' is distinct from v_workspace
     or p_effect_intent->>'recovery_attempt_id' is distinct from v_attempt
     or p_effect_intent->>'restart_intent_id' is distinct from v_restart_intent
     or p_effect_intent->>'lease_id' is distinct from v_lease
     or p_effect_intent->>'target_client_id' is distinct from v_client
     or p_effect_intent->>'target_process_incarnation_id' is distinct from v_process
     or (p_effect_intent->>'supervisor_epoch')::bigint is distinct from v_epoch
     or p_effect_intent->>'expected_source_git_commit' is distinct from v_source then
    raise exception 'restart effect intent provenance mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-effect-intent.v1',
    'intent_bound',true,
    'reason','DURABLE_RECOVERY_RESTART_EFFECT_INTENT_BOUND',
    'workspace_id',v_workspace,
    'recovery_attempt_id',v_attempt,
    'restart_intent_id',v_restart_intent,
    'lease_id',v_lease,
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_scope','BROWSER_RESTART',
    'target_client_id',v_client,
    'target_process_incarnation_id',v_process,
    'supervisor_epoch',v_epoch,
    'expected_source_git_commit',v_source,
    'recovery_restart_precondition_fingerprint_sha256',p_recovery_restart_readback->>'recovery_restart_precondition_fingerprint_sha256',
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);
end $$;

revoke all on function public.h205f22_compute_unified_recovery_restart_effect_intent_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_compute_unified_recovery_restart_effect_intent_v1(jsonb,jsonb) to service_role;
