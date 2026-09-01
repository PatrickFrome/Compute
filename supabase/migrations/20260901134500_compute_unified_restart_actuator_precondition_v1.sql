-- Branch-local C0 hardening: compose durable restart-intent readback with
-- typed-actuator + lease evidence without granting restart authority.

create or replace function public.h205f22_compute_unified_restart_actuator_precondition_v1(
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
  v_workspace text;
  v_client text;
  v_process text;
  v_epoch bigint;
  v_source_commit text;
  v_lease_id text;
begin
  if p_restart_readback is null or p_actuator_evidence is null then
    raise exception 'restart actuator precondition evidence required';
  end if;

  if not coalesce((p_restart_readback->>'verified')::boolean,false)
     or not coalesce((p_restart_readback->>'latest')::boolean,false)
     or coalesce((p_restart_readback->>'authority_effect')::boolean,true)
     or coalesce((p_restart_readback->>'restart_authorized')::boolean,true)
     or coalesce((p_restart_readback->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_restart_readback->>'lease_mutation_authorized')::boolean,true)
     or p_restart_readback->>'state' is distinct from 'ROLLOVER' then
    raise exception 'restart readback is not clean zero-authority rollover evidence';
  end if;

  if not coalesce((p_actuator_evidence->>'typed_actuator_verified')::boolean,false)
     or not coalesce((p_actuator_evidence->>'lease_verified')::boolean,false)
     or coalesce((p_actuator_evidence->>'authority_effect')::boolean,true)
     or p_actuator_evidence->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or p_actuator_evidence->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR' then
    raise exception 'typed lease-holding restart actuator evidence rejected';
  end if;

  v_workspace := p_restart_readback->>'workspace_id';
  v_client := p_restart_readback->>'successor_client_id';
  v_process := p_restart_readback->>'successor_process_incarnation_id';
  v_epoch := (p_restart_readback->>'successor_supervisor_epoch')::bigint;
  v_source_commit := p_restart_readback->>'expected_source_git_commit';
  v_lease_id := p_actuator_evidence->>'lease_id';

  if v_workspace is null or v_client is null or v_process is null or v_epoch is null
     or v_source_commit !~ '^[0-9a-f]{40}$' or nullif(v_lease_id,'') is null then
    raise exception 'restart provenance is incomplete';
  end if;

  if p_actuator_evidence->>'workspace_id' is distinct from v_workspace
     or p_actuator_evidence->>'target_client_id' is distinct from v_client
     or p_actuator_evidence->>'target_process_incarnation_id' is distinct from v_process
     or (p_actuator_evidence->>'supervisor_epoch')::bigint is distinct from v_epoch
     or p_actuator_evidence->>'expected_source_git_commit' is distinct from v_source_commit then
    raise exception 'typed actuator provenance mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-actuator-precondition.v1',
    'preconditions_verified',true,
    'workspace_id',v_workspace,
    'restart_intent_id',(p_restart_readback->>'restart_intent_id')::bigint,
    'lease_id',v_lease_id,
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
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_restart_actuator_precondition_v1(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_restart_actuator_precondition_v1(jsonb,jsonb) to service_role;
