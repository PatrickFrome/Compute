-- METAENGINE Command Fabric v2 source contract.
-- Intentionally rollback-only: this file is NOT under supabase/migrations and must
-- not be treated as deployed authority. Qualification must promote it separately.

begin;

create or replace function public.h205f22_a2_browser_supervisor_issue_batch_v2(
  p_client_id text,
  p_manifest_revision text,
  p_commands jsonb,
  p_issued_by text default 'command-fabric-v2'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_manifest_revision constant text := 'sha256:bf19e8d035bdd910982c61e50e53993a3bea945ab2c7396b6d7aa9dd0b383bd5';
  v_item jsonb;
  v_action text;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer;
begin
  if p_manifest_revision is distinct from v_expected_manifest_revision then
    raise exception 'capability_revision_mismatch' using errcode = '22023';
  end if;
  if jsonb_typeof(p_commands) <> 'array' then
    raise exception 'commands_must_be_array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_commands);
  if v_count < 1 or v_count > 64 then
    raise exception 'command_batch_size_invalid' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_commands)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'command_item_invalid' using errcode = '22023';
    end if;
    v_action := upper(btrim(coalesce(v_item->>'action', '')));
    if v_action not in (
      'POLL','CAPTURE','CAPTURE_VIEW','DOWNLOAD_STATUS',
      'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
      'SELF_UPDATE_STATUS','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK',
      'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
      'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','NEW_TAB',
      'FLEET_RECONCILE','FLEET_SET_PROFILE','DOWNLOAD_FILE','DOWNLOAD_CANCEL','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
    ) then
      raise exception 'command_action_not_in_generic_issue_v1:%', v_action using errcode = '22023';
    end if;
    if coalesce(v_item->>'idempotency_key', '') = '' then
      raise exception 'command_idempotency_key_required' using errcode = '22023';
    end if;
    if length(v_item->>'idempotency_key') > 200 then
      raise exception 'command_idempotency_key_too_long' using errcode = '22023';
    end if;

    v_result := public.h205f22_a2_browser_supervisor_issue_native_v1(
      p_client_id,
      v_action,
      nullif(v_item->>'platform', ''),
      coalesce(v_item->'payload', '{}'::jsonb),
      least(greatest(coalesce((v_item->>'ttl_seconds')::integer, 60), 5), 900),
      left(coalesce(nullif(p_issued_by, ''), 'command-fabric-v2'), 120),
      v_item->>'idempotency_key'
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'schema', 'metaengine.command-fabric.issue-batch.v2',
    'manifest_revision', v_expected_manifest_revision,
    'count', v_count,
    'commands', v_results,
    'delegates_to_existing_typed_issuer', true,
    'automatic_effect_retry_allowed', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_batch_v2(text,text,jsonb,text) from public;
revoke all on function public.h205f22_a2_browser_supervisor_issue_batch_v2(text,text,jsonb,text) from anon;
revoke all on function public.h205f22_a2_browser_supervisor_issue_batch_v2(text,text,jsonb,text) from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_batch_v2(text,text,jsonb,text) to service_role;

rollback;
