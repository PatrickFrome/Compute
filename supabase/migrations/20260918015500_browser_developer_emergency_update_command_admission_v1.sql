-- METAENGINE Browser developer emergency update command admission v1.
--
-- This migration closes the remaining durable-control gap for the already shipped
-- native Guardian emergency-update handler. It adds exactly one typed command action
-- and one service-role-only issuer. It does not lease, execute, retry, stage, download,
-- or launch an installer. Browser-side execution remains protected by the enrolled
-- device signature, owner binding, immutable trusted-release resolver, fixed Guardian
-- intake, native write-ahead effect journal and exact installed-executable readback.

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_action_ck;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_action_ck check (action = any(array[
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE',
    'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
    'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE','FLEET_STATUS','TAB_CENSUS',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY',
    'DEVELOPER_EMERGENCY_UPDATE',
    'GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'
  ]::text[]));

create or replace function public.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1(
  p_client_id text,
  p_request_nonce text,
  p_expected_git_sha text default null,
  p_ttl_seconds integer default 300,
  p_issued_by text default 'CHATGPT_SUPERVISOR',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_nonce text := trim(coalesce(p_request_nonce,''));
  v_expected_git_sha text := nullif(lower(trim(coalesce(p_expected_git_sha,''))),'');
  v_issued_by text := left(trim(coalesce(p_issued_by,'CHATGPT_SUPERVISOR')),160);
  v_ttl integer := greatest(60,least(600,coalesce(p_ttl_seconds,300)));
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_key text;
  v_payload jsonb;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_state_json jsonb;
  v_existing public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_inserted boolean := false;
begin
  if v_client='' then raise exception 'developer_emergency_update_client_required'; end if;
  if char_length(v_nonce)<32 or char_length(v_nonce)>128 or v_nonce !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'developer_emergency_update_nonce_invalid';
  end if;
  if v_expected_git_sha is not null and v_expected_git_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'developer_emergency_update_expected_git_sha_invalid';
  end if;
  if v_issued_by='' then raise exception 'developer_emergency_update_issuer_required'; end if;

  select * into v_state
    from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where client_id=v_client and workspace_id=v_workspace;
  if not found then raise exception 'native_supervisor_client_not_seen'; end if;
  if v_state.last_seen_at < clock_timestamp()-interval '45 seconds' then
    raise exception 'native_supervisor_client_stale';
  end if;

  v_state_json := v_state.state;
  if jsonb_typeof(v_state_json)='string' then
    begin
      v_state_json := (v_state_json #>> '{}')::jsonb;
    exception when others then
      raise exception 'native_supervisor_state_transport_invalid';
    end;
  end if;
  if jsonb_typeof(v_state_json)<>'object' then raise exception 'native_supervisor_state_transport_invalid'; end if;
  if coalesce(v_state_json->>'client_kind','') <> 'METAENGINE_BROWSER_ELECTRON_NATIVE' then
    raise exception 'native_supervisor_client_kind_invalid';
  end if;

  v_payload := jsonb_build_object(
    'schema','metaengine.developer-emergency-update.v1',
    'request_nonce',v_nonce,
    'release_mode','LATEST_TRUSTED'
  );
  if v_expected_git_sha is not null then
    v_payload := v_payload || jsonb_build_object('expected_git_sha',v_expected_git_sha);
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key),''),
    'developer-emergency-update:' || v_command_id::text
  );
  if char_length(v_key)<16 or char_length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'developer_emergency_update_idempotency_invalid';
  end if;

  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
    command_id,workspace_id,target_client_id,issued_by,action,platform,payload,status,
    issued_at,expires_at,authority_effect,idempotency_key
  ) values (
    v_command_id,v_workspace,v_client,v_issued_by,'DEVELOPER_EMERGENCY_UPDATE',null,
    v_payload,'PENDING',clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl),
    false,v_key
  )
  on conflict (workspace_id,idempotency_key) where idempotency_key is not null do nothing
  returning * into v_existing;
  v_inserted := found;

  if not v_inserted then
    select * into v_existing
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=v_workspace and idempotency_key=v_key;
    if not found then raise exception 'developer_emergency_update_idempotency_readback_missing'; end if;
    if v_existing.target_client_id is distinct from v_client
       or v_existing.action is distinct from 'DEVELOPER_EMERGENCY_UPDATE'
       or v_existing.platform is not null
       or v_existing.payload is distinct from v_payload then
      raise exception 'developer_emergency_update_idempotency_collision' using errcode='22023';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.developer-emergency-update-command-issue.v1',
    'accepted',true,
    'replayed',not v_inserted,
    'command_id',v_existing.command_id,
    'client_id',v_existing.target_client_id,
    'action',v_existing.action,
    'status',v_existing.status,
    'expires_at',v_existing.expires_at,
    'idempotency_key',v_existing.idempotency_key,
    'request_nonce',v_nonce,
    'expected_git_sha',v_expected_git_sha,
    'release_mode','LATEST_TRUSTED',
    'command_leasing',false,
    'execution_authority',false,
    'installer_dispatch_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$function$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1(text,text,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1(text,text,text,integer,text,text)
  to service_role;

comment on function public.h205f22_a2_browser_supervisor_issue_developer_emergency_update_v1(text,text,text,integer,text,text) is
  'Issues one exact developer emergency update intent to a live native Browser. No lease/execution/install authority; Browser Guardian performs independent owner/device/release/effect-journal verification and forbids blind retry.';
