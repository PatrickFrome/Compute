-- METAENGINE Browser native command issuer replay contract v2.
-- Preserve the deployed state-transport and download URL validation repairs,
-- while making the existing workspace idempotency fence observable at the API.

create or replace function public.h205f22_a2_browser_supervisor_issue_native_v1(
  p_client_id text,
  p_action text,
  p_platform text default null,
  p_payload jsonb default '{}'::jsonb,
  p_ttl_seconds integer default 120,
  p_issued_by text default 'CHATGPT_SUPERVISOR',
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_action text := upper(trim(coalesce(p_action,'')));
  v_platform text := nullif(upper(trim(coalesce(p_platform,''))), '');
  v_issued_by text := left(trim(coalesce(p_issued_by,'CHATGPT_SUPERVISOR')),160);
  v_ttl integer := greatest(30,least(600,coalesce(p_ttl_seconds,120)));
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_key text;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_existing public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_state_json jsonb;
  v_url text;
  v_inserted boolean := false;
begin
  if v_client='' then raise exception 'native_supervisor_client_required'; end if;
  if v_action not in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE','CAPTURE_VIEW',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
  ) then raise exception 'native_supervisor_action_invalid'; end if;
  if v_platform is not null and v_platform not in ('CHATGPT','GLM_ZAI') then raise exception 'native_supervisor_platform_invalid'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 then raise exception 'native_supervisor_payload_invalid'; end if;

  if v_action='DOWNLOAD_FILE' then
    v_url := coalesce(p_payload->>'url','');
    if v_url !~ '^https://[^[:space:]]+$' or char_length(v_url)>4096 then raise exception 'native_supervisor_download_url_invalid'; end if;
    if length(trim(coalesce(p_payload->>'filename',''))) not between 1 and 180 then raise exception 'native_supervisor_download_filename_invalid'; end if;
    if lower(coalesce(p_payload->>'expected_sha256','')) !~ '^[a-f0-9]{64}$' then raise exception 'native_supervisor_download_sha256_invalid'; end if;
    if p_payload ? 'max_bytes' and coalesce(p_payload->>'max_bytes','') !~ '^[0-9]{1,10}$' then raise exception 'native_supervisor_download_max_bytes_invalid'; end if;
  elsif v_action in ('DOWNLOAD_STATUS','DOWNLOAD_CANCEL','SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY') then
    if p_payload <> '{}'::jsonb then raise exception 'native_supervisor_command_payload_must_be_empty'; end if;
  end if;

  select * into v_state
    from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where client_id=v_client and workspace_id=v_workspace;
  if not found then raise exception 'native_supervisor_client_not_seen'; end if;
  if v_state.last_seen_at < clock_timestamp()-interval '15 seconds' then raise exception 'native_supervisor_client_stale'; end if;
  v_state_json := v_state.state;
  if jsonb_typeof(v_state_json)='string' then
    begin
      v_state_json := (v_state_json #>> '{}')::jsonb;
    exception when others then
      raise exception 'native_supervisor_state_transport_invalid';
    end;
  end if;
  if jsonb_typeof(v_state_json)<>'object' then raise exception 'native_supervisor_state_transport_invalid'; end if;
  if coalesce(v_state_json->>'client_kind','') <> 'METAENGINE_BROWSER_ELECTRON_NATIVE' then raise exception 'native_supervisor_client_kind_invalid'; end if;

  v_key := coalesce(nullif(trim(p_idempotency_key),''),'native-supervisor:'||v_command_id::text);
  if char_length(v_key)<16 or char_length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'native_supervisor_idempotency_invalid'; end if;

  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
    command_id,workspace_id,target_client_id,issued_by,action,platform,payload,status,
    issued_at,expires_at,authority_effect,idempotency_key
  ) values (
    v_command_id,v_workspace,v_client,v_issued_by,v_action,v_platform,p_payload,'PENDING',
    clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl),false,v_key
  )
  on conflict (workspace_id,idempotency_key) where idempotency_key is not null do nothing
  returning * into v_existing;
  v_inserted := found;

  if not v_inserted then
    select * into v_existing
      from public.compute_fabric_a2_browser_supervisor_command_h205f22
     where workspace_id=v_workspace and idempotency_key=v_key;
    if not found then raise exception 'native_supervisor_idempotency_readback_missing'; end if;
    if v_existing.target_client_id is distinct from v_client
       or v_existing.action is distinct from v_action
       or coalesce(v_existing.platform,'') is distinct from coalesce(v_platform,'')
       or v_existing.payload is distinct from p_payload then
      raise exception 'native_supervisor_idempotency_collision' using errcode='22023';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.command-issue.v2',
    'accepted',true,
    'replayed',not v_inserted,
    'command_id',v_existing.command_id,
    'client_id',v_existing.target_client_id,
    'action',v_existing.action,
    'platform',v_existing.platform,
    'status',v_existing.status,
    'expires_at',v_existing.expires_at,
    'idempotency_key',v_existing.idempotency_key,
    'command_leasing',false,
    'execution_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_native_v1(text,text,text,jsonb,integer,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_issue_native_v1(text,text,text,jsonb,integer,text,text) to service_role;
