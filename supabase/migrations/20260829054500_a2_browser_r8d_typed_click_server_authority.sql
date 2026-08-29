alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_action_ck;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_action_ck check (
    action = any (array[
      'ARM'::text,'DISARM'::text,'SET_SUPERVISOR_MODE'::text,'SET_MODE'::text,
      'POLL'::text,'CAPTURE'::text,'STOP_GENERATION'::text,'SCROLL'::text,
      'SEMANTIC_FOCUS'::text,'SEMANTIC_TYPE'::text,'RESOLVE_PROMPT'::text,'TYPED_CLICK'::text
    ])
  );

create or replace function public.h205f22_a2_browser_supervisor_enqueue_v3(
  p_workspace_id uuid,
  p_action text,
  p_platform text default null::text,
  p_payload jsonb default '{}'::jsonb,
  p_target_client_id text default null::text,
  p_ttl_seconds integer default 300,
  p_issued_by text default 'CONNECTED_CHAT_SUPERVISOR'::text,
  p_idempotency_key text default null::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_id uuid;
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_action text := upper(coalesce(p_action,''));
  v_platform text := nullif(upper(coalesce(p_platform,'')), '');
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_target text := nullif(left(trim(coalesce(p_target_client_id,'')),160),'');
  v_issued_by text := left(coalesce(nullif(trim(coalesce(p_issued_by,'')),''),'CONNECTED_CHAT_SUPERVISOR'),160);
  v_key text := trim(coalesce(p_idempotency_key,''));
  v_ttl integer := greatest(30, least(1800, coalesce(p_ttl_seconds,300)));
  v_supervisor_mode text;
  v_payload_keys text[];
begin
  if v_action not in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK'
  ) then
    raise exception 'supervisor_action_invalid';
  end if;
  if v_platform is not null and v_platform not in ('CHATGPT','GLM_ZAI') then
    raise exception 'supervisor_platform_invalid';
  end if;
  if length(v_key) not between 16 and 160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'supervisor_idempotency_key_invalid';
  end if;
  if v_action = 'SET_SUPERVISOR_MODE' then
    v_supervisor_mode := upper(coalesce(v_payload->>'mode',''));
    if v_supervisor_mode not in ('OFF','MONITOR','CONTROL') then
      raise exception 'supervisor_bootstrap_mode_invalid';
    end if;
  end if;
  if v_action = 'TYPED_CLICK' then
    if v_platform is null then raise exception 'supervisor_typed_click_platform_required'; end if;
    if jsonb_typeof(v_payload) is distinct from 'object' then raise exception 'supervisor_typed_click_payload_invalid'; end if;
    select array_agg(k order by k) into v_payload_keys from jsonb_object_keys(v_payload) as x(k);
    if v_payload_keys is distinct from array['accessible_name','action_id','role']::text[] then
      raise exception 'supervisor_typed_click_payload_fields_invalid';
    end if;
    if coalesce(v_payload->>'action_id','') !~ '^[a-z0-9][a-z0-9._:-]{2,127}$' then
      raise exception 'supervisor_typed_click_action_id_invalid';
    end if;
    if lower(trim(coalesce(v_payload->>'role',''))) not in ('button','checkbox','radio','switch','tab','menuitem') then
      raise exception 'supervisor_typed_click_role_invalid';
    end if;
    if length(trim(coalesce(v_payload->>'accessible_name',''))) not between 1 and 500 then
      raise exception 'supervisor_typed_click_accessible_name_invalid';
    end if;
  end if;

  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(
    workspace_id,target_client_id,issued_by,action,platform,payload,expires_at,idempotency_key,authority_effect
  ) values (
    p_workspace_id,v_target,v_issued_by,v_action,v_platform,v_payload,
    clock_timestamp()+make_interval(secs=>v_ttl),v_key,false
  )
  on conflict (workspace_id,idempotency_key) where idempotency_key is not null do nothing
  returning command_id into v_id;

  select * into v_row
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and idempotency_key=v_key
  limit 1;
  if not found then raise exception 'supervisor_idempotency_readback_missing'; end if;
  if v_row.action is distinct from v_action
     or v_row.platform is distinct from v_platform
     or v_row.payload is distinct from v_payload
     or v_row.target_client_id is distinct from v_target
     or v_row.issued_by is distinct from v_issued_by then
    raise exception 'supervisor_idempotency_conflict';
  end if;
  return jsonb_build_object(
    'command_id',v_row.command_id,'status',v_row.status,'action',v_row.action,
    'platform',v_row.platform,'idempotency_key',v_row.idempotency_key,
    'replayed',v_id is null,'authority_effect',false
  );
end;
$function$;

create or replace function public.h205f22_a2_browser_supervisor_lease_v3(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF'::text,
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
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at <= v_now;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at <= v_now or leased_at is null or leased_at <= v_now - make_interval(secs=>v_lease_timeout));

  select coalesce(sum(case
      when action in ('POLL','CAPTURE','DISARM') then 0
      when action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF' then 0
      when action in ('SCROLL','SEMANTIC_FOCUS') then 1
      when action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION') then 2
      when action='SEMANTIC_TYPE' then 3
      when action in ('RESOLVE_PROMPT','TYPED_CLICK') then 4
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
    and (v_mode='CONTROL' or action in ('SET_SUPERVISOR_MODE','ARM','DISARM'))
  order by issued_at asc for update skip locked limit 1;
  if not found then
    return jsonb_build_object('command',null,'guard',jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1','window_seconds',60,
      'limit',v_budget_limit,'used_cost',v_used_cost,'failure_limit',v_failure_limit,
      'recent_failures',v_recent_failures,'circuit_open',false));
  end if;

  v_emergency := v_row.action='DISARM' or
    (v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF');
  v_requested_cost := case
    when v_row.action in ('POLL','CAPTURE','DISARM') then 0
    when v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF' then 0
    when v_row.action in ('SCROLL','SEMANTIC_FOCUS') then 1
    when v_row.action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION') then 2
    when v_row.action='SEMANTIC_TYPE' then 3
    when v_row.action in ('RESOLVE_PROMPT','TYPED_CLICK') then 4
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

create or replace function public.h205f22_a2_browser_supervisor_complete_v4(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_ok boolean,
  p_receipt jsonb default '{}'::jsonb,
  p_error text default null::text,
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
begin
  if p_workspace_id is null or p_command_id is null or v_client='' then
    raise exception 'supervisor_result_identity_invalid';
  end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status=case when coalesce(p_ok,false) then 'COMPLETED' else 'FAILED' end,
         completed_at=clock_timestamp(),
         receipt=case when coalesce(p_ok,false) then
           jsonb_set(coalesce(p_receipt,'{}'::jsonb),'{authority_effect}',to_jsonb(
             action in ('ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK')
           ),true)
         else null end,
         error=case when coalesce(p_ok,false) then null else v_error end,
         authority_effect=coalesce(p_ok,false) and action in (
           'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL',
           'SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK'
         )
   where workspace_id=p_workspace_id and command_id=p_command_id and status='LEASED'
     and leased_by=v_client and expires_at>clock_timestamp() and leased_at is not null
     and leased_at>clock_timestamp()-interval '10 minutes'
  returning * into v_row;
  if found then
    return jsonb_build_object('accepted',true,'status',v_row.status,'authority_effect',v_row.authority_effect);
  end if;
  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22
    where workspace_id=p_workspace_id and command_id=p_command_id;
  if not found then raise exception 'supervisor_command_not_found'; end if;
  if v_row.status='LEASED' and v_row.leased_by=v_client then
    return jsonb_build_object('accepted',false,'status','EXPIRED','error','supervisor_lease_expired','authority_effect',false);
  end if;
  return jsonb_build_object('accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false);
end;
$function$;
