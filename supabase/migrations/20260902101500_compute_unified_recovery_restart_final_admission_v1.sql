-- Branch-local C0 hardening: compose durable restart-effect proof with fresh runtime/self-update evidence.
-- Evidence only: this function never authorizes or performs a Browser restart.
create or replace function public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(
  p_effect_intent_readback jsonb,
  p_runtime_snapshot jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_workspace_id text;
  v_restart_intent_id text;
  v_lease_id text;
  v_client_id text;
  v_process_incarnation_id text;
  v_source_sha text;
  v_epoch bigint;
begin
  if coalesce(p_effect_intent_readback->>'schema','') <> 'metaengine.compute-unified.recovery-restart-effect-intent-readback.v1'
     or not coalesce((p_effect_intent_readback->>'verified')::boolean,false)
     or p_effect_intent_readback->>'reason' <> 'RECOVERY_RESTART_EFFECT_INTENT_DURABLE_PROOF_VERIFIED'
     or coalesce((p_effect_intent_readback->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_effect_intent_readback->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_effect_intent_readback->>'post_effect_readback_required')::boolean,false)
     or coalesce((p_effect_intent_readback->>'restart_authorized')::boolean,true)
     or coalesce((p_effect_intent_readback->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_effect_intent_readback->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_effect_intent_readback->>'promotion_authorized')::boolean,true)
     or coalesce((p_effect_intent_readback->>'authority_effect')::boolean,true) then
    raise exception 'durable restart-effect proof is not terminal zero-authority verified evidence';
  end if;

  v_workspace_id := p_effect_intent_readback->>'workspace_id';
  v_restart_intent_id := p_effect_intent_readback->>'restart_intent_id';
  v_lease_id := p_effect_intent_readback->>'lease_id';
  v_client_id := p_effect_intent_readback->>'target_client_id';
  v_process_incarnation_id := p_effect_intent_readback->>'target_process_incarnation_id';
  v_source_sha := p_effect_intent_readback->>'expected_source_git_commit';
  v_epoch := (p_effect_intent_readback->>'supervisor_epoch')::bigint;

  if coalesce(p_runtime_snapshot->>'schema','') <> 'metaengine.browser.recovery-runtime-snapshot.v1'
     or not coalesce((p_runtime_snapshot->>'heartbeat_fresh')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'quiescent')::boolean,false)
     or coalesce((p_runtime_snapshot->>'active_wake_count')::bigint,-1) <> 0
     or coalesce((p_runtime_snapshot->>'queued_wake_count')::bigint,-1) <> 0
     or coalesce((p_runtime_snapshot->>'ambiguous_wake_count')::bigint,-1) <> 0
     or coalesce((p_runtime_snapshot->>'active_worker_generation_count')::bigint,-1) <> 0
     or coalesce((p_runtime_snapshot->>'active_supervisor_generation_count')::bigint,-1) <> 0
     or coalesce((p_runtime_snapshot->>'active_actuation_lease_count')::bigint,-1) <> 1
     or p_runtime_snapshot->>'workspace_id' is distinct from v_workspace_id
     or p_runtime_snapshot->>'restart_intent_id' is distinct from v_restart_intent_id
     or p_runtime_snapshot->>'lease_id' is distinct from v_lease_id
     or p_runtime_snapshot->>'target_client_id' is distinct from v_client_id
     or p_runtime_snapshot->>'target_process_incarnation_id' is distinct from v_process_incarnation_id
     or (p_runtime_snapshot->>'supervisor_epoch')::bigint is distinct from v_epoch
     or p_runtime_snapshot->>'integration_source_git_commit' is distinct from v_source_sha
     or p_runtime_snapshot->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or p_runtime_snapshot->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or not coalesce((p_runtime_snapshot->>'typed_lease_valid')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'supervisor_keepalive_continuous')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'enrollment_active')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'trusted_update_channel_match')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'update_metadata_verified')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'update_publisher_verified')::boolean,false)
     or not coalesce((p_runtime_snapshot->>'restart_gate_safe')::boolean,false)
     or coalesce((p_runtime_snapshot->>'downgrade_requested')::boolean,true)
     or coalesce((p_runtime_snapshot->>'web_installer_used')::boolean,true)
     or coalesce((p_runtime_snapshot->>'automatic_retry_allowed')::boolean,true)
     or coalesce((p_runtime_snapshot->>'authority_effect')::boolean,true) then
    raise exception 'fresh quiescent typed restart runtime/self-update preconditions not proven';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-final-admission.v1',
    'verified',true,
    'reason','RECOVERY_RESTART_FINAL_PRECONDITIONS_VERIFIED_NOT_AUTHORIZED',
    'workspace_id',v_workspace_id,
    'restart_intent_id',v_restart_intent_id,
    'lease_id',v_lease_id,
    'target_client_id',v_client_id,
    'target_process_incarnation_id',v_process_incarnation_id,
    'supervisor_epoch',v_epoch,
    'expected_source_git_commit',v_source_sha,
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb) from public;
revoke all on function public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb) from anon;
revoke all on function public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb) from authenticated;
grant execute on function public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb) to service_role;
