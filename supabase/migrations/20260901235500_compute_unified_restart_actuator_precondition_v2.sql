-- C0 continuity-compatible restart actuator precondition v2.
--
-- This is a pure verifier. It does not restart the Browser, lease an actuator,
-- enqueue a wake, mutate supervisor state, or grant authority. The trusted
-- native runtime must supply both evidence envelopes. Chat/page/model text is
-- not a valid evidence source.

create or replace function public.compute_unified_restart_actuator_precondition_v2(
  p_continuity jsonb,
  p_actuator jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id text;
  v_client_id text;
  v_process_incarnation_id text;
  v_supervisor_epoch bigint;
  v_source_git_sha text;
  v_lease_id text;
  v_generation_state text;
  v_queued_wakes integer;
begin
  if jsonb_typeof(p_continuity) <> 'object'
     or p_continuity->>'schema' <> 'metaengine.restart.continuity-evidence.v2'
     or coalesce((p_continuity->>'state_read_ok')::boolean, false) is not true
     or coalesce((p_continuity->>'durable_handoff_ready')::boolean, false) is not true
     or coalesce((p_continuity->>'active_actuation_lease')::boolean, true) is not false
     or coalesce((p_continuity->>'verified_download_mutation_active')::boolean, true) is not false
     or coalesce((p_continuity->>'authority_effect')::boolean, true) is not false then
    raise exception 'restart_continuity_evidence_invalid' using errcode = '22023';
  end if;

  v_workspace_id := nullif(p_continuity->>'workspace_id', '');
  v_client_id := nullif(p_continuity->>'client_id', '');
  v_process_incarnation_id := nullif(p_continuity->>'process_incarnation_id', '');
  v_source_git_sha := lower(nullif(p_continuity->>'source_git_sha', ''));
  v_generation_state := upper(coalesce(nullif(p_continuity->>'supervisor_generation', ''), 'UNKNOWN'));
  v_queued_wakes := greatest(0, coalesce((p_continuity->>'queued_wakes')::integer, 0));

  begin
    v_supervisor_epoch := (p_continuity->>'supervisor_epoch')::bigint;
  exception when others then
    raise exception 'restart_continuity_binding_invalid' using errcode = '22023';
  end;

  if v_workspace_id is null
     or v_client_id is null
     or v_process_incarnation_id is null
     or v_supervisor_epoch < 0
     or v_source_git_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'restart_continuity_binding_invalid' using errcode = '22023';
  end if;

  -- Generation/streaming/wake backlog are continuity state, not restart blockers.
  -- We preserve them in the verified envelope so the successor can reconcile
  -- them, but never require IDLE/quiescent/empty queues here.
  if jsonb_typeof(p_actuator) <> 'object'
     or p_actuator->>'schema' <> 'metaengine.restart.actuator-evidence.v1'
     or coalesce((p_actuator->>'typed_actuator_verified')::boolean, false) is not true
     or coalesce((p_actuator->>'lease_verified')::boolean, false) is not true
     or p_actuator->>'effect_scope' <> 'BROWSER_RESTART'
     or p_actuator->>'actuator_type' <> 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or coalesce((p_actuator->>'authority_effect')::boolean, true) is not false then
    raise exception 'restart_actuator_evidence_invalid' using errcode = '22023';
  end if;

  v_lease_id := nullif(p_actuator->>'lease_id', '');
  if v_lease_id is null
     or p_actuator->>'workspace_id' is distinct from v_workspace_id
     or p_actuator->>'client_id' is distinct from v_client_id
     or p_actuator->>'process_incarnation_id' is distinct from v_process_incarnation_id
     or p_actuator->>'supervisor_epoch' is distinct from v_supervisor_epoch::text
     or lower(coalesce(p_actuator->>'source_git_sha', '')) is distinct from v_source_git_sha then
    raise exception 'restart_actuator_binding_mismatch' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'schema', 'metaengine.restart.actuator-precondition.v2',
    'preconditions_verified', true,
    'workspace_id', v_workspace_id,
    'client_id', v_client_id,
    'process_incarnation_id', v_process_incarnation_id,
    'supervisor_epoch', v_supervisor_epoch,
    'source_git_sha', v_source_git_sha,
    'lease_id', v_lease_id,
    'effect_scope', 'BROWSER_RESTART',
    'actuator_type', 'NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_must_be_single_shot', true,
    'post_effect_readback_required', true,
    'continuity_transfer_required', true,
    'supervisor_generation', v_generation_state,
    'queued_wakes', v_queued_wakes,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.compute_unified_restart_actuator_precondition_v2(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.compute_unified_restart_actuator_precondition_v2(jsonb, jsonb) to service_role;
