begin;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_action_ck;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_action_ck check (action = any (array[
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','KEY_PRESS','SET_ZOOM',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
  ]::text[]));

create or replace function public.h205f22_a2_browser_supervisor_issue_native_v2(
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
set search_path to 'public','pg_temp'
as $function$
declare
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_action text := upper(trim(coalesce(p_action,'')));
  v_platform text := nullif(upper(trim(coalesce(p_platform,''))), '');
  v_issued_by text := left(trim(coalesce(p_issued_by,'CHATGPT_SUPERVISOR')),160);
  v_ttl integer := greatest(30,least(600,coalesce(p_ttl_seconds,120)));
  v_command_id uuid := pg_catalog.gen_random_uuid();
  v_key text;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_key_name text;
  v_modifier text;
begin
  if v_client='' then raise exception 'native_supervisor_client_required'; end if;
  if v_action not in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','KEY_PRESS','SET_ZOOM',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
    'DOWNLOAD_STATUS','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
  ) then raise exception 'native_supervisor_action_invalid'; end if;
  if v_platform is not null and v_platform not in ('CHATGPT','GLM_ZAI') then raise exception 'native_supervisor_platform_invalid'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 then raise exception 'native_supervisor_payload_invalid'; end if;

  if p_payload ? 'tab_id' then
    if jsonb_typeof(p_payload->'tab_id') <> 'string'
       or coalesce(p_payload->>'tab_id','') !~ '^tab_[A-Za-z0-9-]{1,80}$'
    then raise exception 'native_supervisor_tab_id_invalid'; end if;
  end if;

  if v_action='DOWNLOAD_FILE' then
    if coalesce(p_payload->>'url','') !~ '^https://[^[:space:]]{1,4088}$' then raise exception 'native_supervisor_download_url_invalid'; end if;
    if length(trim(coalesce(p_payload->>'filename',''))) not between 1 and 180 then raise exception 'native_supervisor_download_filename_invalid'; end if;
    if lower(coalesce(p_payload->>'expected_sha256','')) !~ '^[a-f0-9]{64}$' then raise exception 'native_supervisor_download_sha256_invalid'; end if;
    if p_payload ? 'max_bytes' and coalesce(p_payload->>'max_bytes','') !~ '^[0-9]{1,10}$' then raise exception 'native_supervisor_download_max_bytes_invalid'; end if;
  elsif v_action in ('DOWNLOAD_STATUS','DOWNLOAD_CANCEL','SELF_UPDATE_STATUS','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY','CONTROL_CAPABILITIES') then
    if p_payload <> '{}'::jsonb then raise exception 'native_supervisor_command_payload_must_be_empty'; end if;
  elsif v_action='KEY_PRESS' then
    for v_key_name in select jsonb_object_keys(p_payload) loop
      if v_key_name not in ('tab_id','key','modifiers') then raise exception 'native_supervisor_key_payload_key_invalid'; end if;
    end loop;
    if jsonb_typeof(p_payload->'key') <> 'string' then raise exception 'native_supervisor_key_required'; end if;
    if not (
      coalesce(p_payload->>'key','') ~ '^[A-Za-z0-9]$'
      or upper(coalesce(p_payload->>'key','')) in ('BACKSPACE','DELETE','INSERT','ENTER','RETURN','ESCAPE','ESC','TAB','SPACE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN')
      or upper(coalesce(p_payload->>'key','')) ~ '^F([1-9]|1[0-9]|2[0-4])$'
    ) then raise exception 'native_supervisor_key_not_allowlisted'; end if;
    if p_payload ? 'modifiers' then
      if jsonb_typeof(p_payload->'modifiers') <> 'array' or jsonb_array_length(p_payload->'modifiers') > 4 then
        raise exception 'native_supervisor_key_modifiers_invalid';
      end if;
      for v_modifier in select jsonb_array_elements_text(p_payload->'modifiers') loop
        if upper(v_modifier) not in ('PRIMARY','CMDORCTRL','COMMANDORCONTROL','SHIFT','CTRL','CONTROL','ALT','META','COMMAND','CMD') then
          raise exception 'native_supervisor_key_modifier_not_allowlisted';
        end if;
      end loop;
    end if;
  elsif v_action='SET_ZOOM' then
    for v_key_name in select jsonb_object_keys(p_payload) loop
      if v_key_name not in ('tab_id','factor') then raise exception 'native_supervisor_zoom_payload_key_invalid'; end if;
    end loop;
    if not (p_payload ? 'factor') or jsonb_typeof(p_payload->'factor') <> 'number' then raise exception 'native_supervisor_zoom_factor_required'; end if;
    if (p_payload->>'factor')::numeric < 0.5 or (p_payload->>'factor')::numeric > 3.0 then raise exception 'native_supervisor_zoom_factor_out_of_range'; end if;
  end if;

  select * into v_state
    from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where client_id=v_client and workspace_id='2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  if not found then raise exception 'native_supervisor_client_not_seen'; end if;
  if v_state.last_seen_at < clock_timestamp()-interval '15 seconds' then raise exception 'native_supervisor_client_stale'; end if;
  if coalesce(v_state.state->>'client_kind','') <> 'METAENGINE_BROWSER_ELECTRON_NATIVE' then raise exception 'native_supervisor_client_kind_invalid'; end if;
  v_key := coalesce(nullif(trim(p_idempotency_key),''),'native-supervisor:'||v_command_id::text);
  if char_length(v_key)<16 or char_length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'native_supervisor_idempotency_invalid'; end if;
  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
    command_id,workspace_id,target_client_id,issued_by,action,platform,payload,status,
    issued_at,expires_at,authority_effect,idempotency_key
  ) values (
    v_command_id,'2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid,v_client,v_issued_by,v_action,v_platform,p_payload,'PENDING',
    clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl),false,v_key
  );
  return jsonb_build_object(
    'accepted',true,'command_id',v_command_id,'client_id',v_client,'action',v_action,
    'platform',v_platform,'expires_at',clock_timestamp()+make_interval(secs=>v_ttl),
    'idempotency_key',v_key,'authority_effect',false
  );
end;
$function$;

create or replace function public.h205f22_a2_browser_supervisor_complete_v6(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_ok boolean,
  p_receipt jsonb default '{}'::jsonb,
  p_error text default null,
  p_authority_effect boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_error text := left(coalesce(p_error,'command_failed'),500);
  v_effect boolean;
begin
  if p_workspace_id is null or p_command_id is null or v_client='' then raise exception 'supervisor_result_identity_invalid'; end if;
  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id for update;
  if not found then raise exception 'supervisor_command_not_found'; end if;
  v_effect := coalesce(p_ok,false) and v_row.action in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL',
    'SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','KEY_PRESS','SET_ZOOM',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE',
    'DOWNLOAD_FILE','DOWNLOAD_CANCEL','SELF_UPDATE_CHECK','SELF_UPDATE_APPLY'
  );
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status=case when coalesce(p_ok,false) then 'COMPLETED' else 'FAILED' end,
         completed_at=clock_timestamp(),
         receipt=case when coalesce(p_ok,false) then jsonb_set(coalesce(p_receipt,'{}'::jsonb),'{authority_effect}',to_jsonb(v_effect),true) else null end,
         error=case when coalesce(p_ok,false) then null else v_error end,
         authority_effect=v_effect
   where workspace_id=p_workspace_id and command_id=p_command_id and status='LEASED'
     and leased_by=v_client and expires_at>clock_timestamp() and leased_at is not null
     and leased_at>clock_timestamp()-interval '10 minutes'
  returning * into v_row;
  if found then return jsonb_build_object('accepted',true,'status',v_row.status,'authority_effect',v_row.authority_effect); end if;
  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22 where workspace_id=p_workspace_id and command_id=p_command_id;
  if v_row.status='LEASED' and v_row.leased_by=v_client then return jsonb_build_object('accepted',false,'status','EXPIRED','error','supervisor_lease_expired','authority_effect',false); end if;
  return jsonb_build_object('accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false);
end;
$function$;

create or replace function public.h205f22_a2_browser_supervisor_lease_v4(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF',
  p_lease_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_mode text := upper(coalesce(p_supervisor_mode,'OFF'));
  v_lease_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds,120)));
  v_now timestamptz := clock_timestamp();
  v_window interval := interval '60 seconds';
  v_budget_limit integer := 24;
  v_failure_limit integer := 5;
  v_used_cost integer := 0;
  v_recent_failures integer := 0;
  v_requested_cost integer := 0;
  v_emergency boolean := false;
  v_guard jsonb;
begin
  if v_client = '' then raise exception 'supervisor_client_id_required'; end if;
  if v_mode not in ('OFF','MONITOR','CONTROL') then raise exception 'supervisor_mode_invalid'; end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='EXPIRED', completed_at=v_now, error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at <= v_now;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='EXPIRED', completed_at=v_now, error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at <= v_now or leased_at is null or leased_at <= v_now - make_interval(secs=>v_lease_timeout));

  select coalesce(sum(case
      when action in ('POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES','DOWNLOAD_STATUS','SELF_UPDATE_STATUS',
                      'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD','DISARM') then 0
      when action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF' then 0
      when action in ('SCROLL','SEMANTIC_FOCUS','DOWNLOAD_CANCEL','KEY_PRESS','SET_ZOOM') then 1
      when action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SELF_UPDATE_CHECK') then 2
      when action='SEMANTIC_TYPE' then 3
      when action in ('RESOLVE_PROMPT','TYPED_CLICK','DOWNLOAD_FILE','SELF_UPDATE_APPLY') then 4
      else 4 end),0)::integer,
    count(*) filter (where status in ('FAILED','EXPIRED'))::integer
  into v_used_cost,v_recent_failures
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and leased_by=v_client and leased_at >= v_now-v_window
    and status in ('LEASED','COMPLETED','FAILED','EXPIRED');

  select * into v_row
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and status='PENDING' and expires_at>v_now
    and (target_client_id is null or target_client_id=v_client)
    and (v_mode='CONTROL' or action in (
      'SET_SUPERVISOR_MODE','ARM','DISARM','POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
      'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD'
    ))
  order by issued_at asc for update skip locked limit 1;
  if not found then
    return jsonb_build_object('command',null,'guard',jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1','window_seconds',60,
      'limit',v_budget_limit,'used_cost',v_used_cost,'failure_limit',v_failure_limit,
      'recent_failures',v_recent_failures,'circuit_open',false));
  end if;

  v_emergency := v_row.action='DISARM' or (v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF');
  v_requested_cost := case
    when v_row.action in ('POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES','DOWNLOAD_STATUS','SELF_UPDATE_STATUS',
                          'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD','DISARM') then 0
    when v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF' then 0
    when v_row.action in ('SCROLL','SEMANTIC_FOCUS','DOWNLOAD_CANCEL','KEY_PRESS','SET_ZOOM') then 1
    when v_row.action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SELF_UPDATE_CHECK') then 2
    when v_row.action='SEMANTIC_TYPE' then 3
    when v_row.action in ('RESOLVE_PROMPT','TYPED_CLICK','DOWNLOAD_FILE','SELF_UPDATE_APPLY') then 4
    else 4 end;

  if not v_emergency and v_recent_failures>=v_failure_limit then
    v_guard:=jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v1','blocked',true,
      'reason','FAILURE_CIRCUIT_OPEN','window_seconds',60,'failure_limit',v_failure_limit,
      'recent_failures',v_recent_failures,'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22
      set status='FAILED',completed_at=v_now,error='supervisor_failure_circuit_open',receipt=v_guard,authority_effect=false
      where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;
  if not v_emergency and v_requested_cost>0 and v_used_cost+v_requested_cost>v_budget_limit then
    v_guard:=jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v1','blocked',true,
      'reason','ACTION_BUDGET_EXCEEDED','window_seconds',60,'used_cost',v_used_cost,
      'requested_cost',v_requested_cost,'limit',v_budget_limit,'failure_limit',v_failure_limit,'recent_failures',v_recent_failures);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22
      set status='FAILED',completed_at=v_now,error='supervisor_action_budget_exceeded',receipt=v_guard,authority_effect=false
      where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
    set status='LEASED',leased_by=v_client,leased_at=v_now where command_id=v_row.command_id;
  return jsonb_build_object('command',jsonb_build_object(
      'command_id',v_row.command_id,'idempotency_key',v_row.idempotency_key,'action',v_row.action,
      'platform',v_row.platform,'payload',v_row.payload,'issued_at',v_row.issued_at,
      'expires_at',v_row.expires_at,'issued_by',v_row.issued_by,'authority_effect',false),
    'guard',jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v1','blocked',false,
      'window_seconds',60,'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,'emergency_bypass',v_emergency));
end;
$function$;

revoke all on function public.h205f22_a2_browser_supervisor_issue_native_v2(text,text,text,jsonb,integer,text,text) from public;
revoke all on function public.h205f22_a2_browser_supervisor_lease_v4(uuid,text,text,integer) from public;
revoke all on function public.h205f22_a2_browser_supervisor_complete_v6(uuid,uuid,text,boolean,jsonb,text,boolean) from public;

grant execute on function public.h205f22_a2_browser_supervisor_issue_native_v2(text,text,text,jsonb,integer,text,text) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v4(uuid,text,text,integer) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_complete_v6(uuid,uuid,text,boolean,jsonb,text,boolean) to service_role;

commit;
