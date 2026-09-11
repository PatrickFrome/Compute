-- METAENGINE owner gate server registry v1.
-- Mirrors successful signed Browser owner-gate commands into the coordination plane
-- so server-side project gates can honor the same wildcard/specific override state.

create table if not exists public.compute_fabric_a2_owner_gate_override_h205f22 (
  workspace_id uuid not null,
  gate_id text not null,
  override_id text not null,
  reason text not null,
  disabled_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  source_command_id uuid,
  authority_effect boolean not null default false,
  primary key (workspace_id,gate_id),
  constraint a2_owner_gate_id_ck check (gate_id ~ '^(\*|[a-z0-9][a-z0-9._:-]{2,127})$'),
  constraint a2_owner_gate_override_id_ck check (override_id ~ '^[A-Za-z0-9._:-]{8,160}$'),
  constraint a2_owner_gate_reason_ck check (length(reason) between 1 and 500),
  constraint a2_owner_gate_expiry_ck check (expires_at is null or expires_at > disabled_at),
  constraint a2_owner_gate_authority_effect_ck check (authority_effect=false),
  constraint a2_owner_gate_command_fk foreign key (source_command_id)
    references public.compute_fabric_a2_browser_supervisor_command_h205f22(command_id)
);

alter table public.compute_fabric_a2_owner_gate_override_h205f22 enable row level security;
revoke all on table public.compute_fabric_a2_owner_gate_override_h205f22 from public, anon, authenticated;

create or replace function public.h205f22_a2_owner_gate_disabled_v1(
  p_workspace_id uuid,
  p_gate_id text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
      from public.compute_fabric_a2_owner_gate_override_h205f22 g
     where g.workspace_id=p_workspace_id
       and g.gate_id in ('*',lower(trim(coalesce(p_gate_id,''))))
       and (g.expires_at is null or g.expires_at>clock_timestamp())
  );
$$;
revoke all on function public.h205f22_a2_owner_gate_disabled_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_owner_gate_disabled_v1(uuid,text) to service_role;

create or replace function public.h205f22_a2_browser_supervisor_lease_v5(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF',
  p_lease_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_mode text := upper(coalesce(p_supervisor_mode,'OFF'));
  v_lease_timeout integer := greatest(30,least(600,coalesce(p_lease_timeout_seconds,120)));
  v_now timestamptz := clock_timestamp();
  v_window interval := interval '60 seconds';
  v_budget_limit integer := 24;
  v_failure_limit integer := 5;
  v_used_cost integer := 0;
  v_recent_failures integer := 0;
  v_requested_cost integer := 0;
  v_emergency boolean := false;
  v_budget_disabled boolean := public.h205f22_a2_owner_gate_disabled_v1(p_workspace_id,'supervisor.action_budget');
  v_failure_circuit_disabled boolean := public.h205f22_a2_owner_gate_disabled_v1(p_workspace_id,'supervisor.failure_circuit');
  v_control_mode_disabled boolean := public.h205f22_a2_owner_gate_disabled_v1(p_workspace_id,'authority.control_mode');
  v_guard jsonb;
begin
  if v_client='' then raise exception 'supervisor_client_id_required'; end if;
  if v_mode not in ('OFF','MONITOR','CONTROL') then raise exception 'supervisor_mode_invalid'; end if;

  delete from public.compute_fabric_a2_owner_gate_override_h205f22
   where workspace_id=p_workspace_id and expires_at is not null and expires_at<=v_now;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='EXPIRED',completed_at=v_now,error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at<=v_now;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='EXPIRED',completed_at=v_now,error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at<=v_now or leased_at is null or leased_at<=v_now-make_interval(secs=>v_lease_timeout));

  select coalesce(sum(case
      when action in ('POLL','CAPTURE','DOWNLOAD_STATUS','SELF_UPDATE_STATUS','DISARM','GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL') then 0
      when action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF' then 0
      when action in ('SCROLL','SEMANTIC_FOCUS','DOWNLOAD_CANCEL') then 1
      when action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SELF_UPDATE_CHECK') then 2
      when action='SEMANTIC_TYPE' then 3
      when action in ('RESOLVE_PROMPT','TYPED_CLICK','DOWNLOAD_FILE','SELF_UPDATE_APPLY') then 4
      else 4 end),0)::integer,
    count(*) filter (where status in ('FAILED','EXPIRED') and action not in ('GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'))::integer
  into v_used_cost,v_recent_failures
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and leased_by=v_client and leased_at>=v_now-v_window
    and status in ('LEASED','COMPLETED','FAILED','EXPIRED');

  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id and status='PENDING' and expires_at>v_now
    and (target_client_id is null or target_client_id=v_client)
    and (v_mode='CONTROL' or v_control_mode_disabled or action in (
      'SET_SUPERVISOR_MODE','ARM','DISARM','POLL','CAPTURE','CAPTURE_VIEW','DOWNLOAD_STATUS','SELF_UPDATE_STATUS',
      'GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'
    ))
  order by case when action in ('GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL') then 0 else 1 end, issued_at asc
  for update skip locked limit 1;

  if not found then return jsonb_build_object('command',null,'guard',jsonb_build_object(
    'schema','metaengine.a2-browser-supervisor.action-budget.v2','window_seconds',60,'limit',v_budget_limit,
    'used_cost',v_used_cost,'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,
    'budget_disabled_by_owner',v_budget_disabled,'failure_circuit_disabled_by_owner',v_failure_circuit_disabled,
    'control_mode_disabled_by_owner',v_control_mode_disabled,'circuit_open',false)); end if;

  v_emergency := v_row.action in ('DISARM','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL')
    or (v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF');
  v_requested_cost := case
    when v_row.action in ('POLL','CAPTURE','DOWNLOAD_STATUS','SELF_UPDATE_STATUS','DISARM','GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL') then 0
    when v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF' then 0
    when v_row.action in ('SCROLL','SEMANTIC_FOCUS','DOWNLOAD_CANCEL') then 1
    when v_row.action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SELF_UPDATE_CHECK') then 2
    when v_row.action='SEMANTIC_TYPE' then 3
    when v_row.action in ('RESOLVE_PROMPT','TYPED_CLICK','DOWNLOAD_FILE','SELF_UPDATE_APPLY') then 4
    else 4 end;

  if not v_emergency and not v_failure_circuit_disabled and v_recent_failures>=v_failure_limit then
    v_guard:=jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v2','blocked',true,
      'reason','FAILURE_CIRCUIT_OPEN','window_seconds',60,'failure_limit',v_failure_limit,
      'recent_failures',v_recent_failures,'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit,
      'failure_circuit_disabled_by_owner',false);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='FAILED',completed_at=v_now,
      error='supervisor_failure_circuit_open',receipt=v_guard,authority_effect=false where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;
  if not v_emergency and not v_budget_disabled and v_requested_cost>0 and v_used_cost+v_requested_cost>v_budget_limit then
    v_guard:=jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v2','blocked',true,
      'reason','ACTION_BUDGET_EXCEEDED','window_seconds',60,'used_cost',v_used_cost,'requested_cost',v_requested_cost,
      'limit',v_budget_limit,'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,
      'budget_disabled_by_owner',false);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='FAILED',completed_at=v_now,
      error='supervisor_action_budget_exceeded',receipt=v_guard,authority_effect=false where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='LEASED',leased_by=v_client,leased_at=v_now
   where command_id=v_row.command_id;
  return jsonb_build_object('command',jsonb_build_object(
      'command_id',v_row.command_id,'idempotency_key',v_row.idempotency_key,'action',v_row.action,
      'platform',v_row.platform,'payload',v_row.payload,'issued_at',v_row.issued_at,
      'expires_at',v_row.expires_at,'issued_by',v_row.issued_by,'authority_effect',false),
    'guard',jsonb_build_object('schema','metaengine.a2-browser-supervisor.action-budget.v2','blocked',false,
      'window_seconds',60,'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,'emergency_bypass',v_emergency,
      'budget_disabled_by_owner',v_budget_disabled,'failure_circuit_disabled_by_owner',v_failure_circuit_disabled,
      'control_mode_disabled_by_owner',v_control_mode_disabled));
end;
$$;

create or replace function public.h205f22_a2_browser_supervisor_complete_v7(
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
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_error text := left(coalesce(p_error,'command_failed'),500);
  v_effect boolean;
  v_gate_id text;
  v_override_id text;
  v_reason text;
  v_override_ttl integer;
  v_expires_at timestamptz;
begin
  if p_workspace_id is null or p_command_id is null or v_client='' then raise exception 'supervisor_result_identity_invalid'; end if;
  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id for update;
  if not found then raise exception 'supervisor_command_not_found'; end if;

  v_effect := coalesce(p_ok,false) and v_row.action in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION','SCROLL',
    'SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK',
    'NEW_TAB','SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD',
    'FLEET_RECONCILE','FLEET_SET_PROFILE','DOWNLOAD_FILE','DOWNLOAD_CANCEL',
    'SELF_UPDATE_CHECK','SELF_UPDATE_APPLY','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'
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

  if found and coalesce(p_ok,false) and v_row.action in ('GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL') then
    v_gate_id := case when v_row.action in ('GATE_DISABLE_ALL','GATE_ENABLE_ALL') then '*' else lower(trim(v_row.payload->>'gate_id')) end;
    v_override_id := trim(coalesce(v_row.payload->>'override_id',''));
    v_reason := trim(coalesce(v_row.payload->>'reason',case when v_row.action like 'GATE_ENABLE%' then 'OWNER_REENABLED' else 'OWNER_OVERRIDE' end));
    if v_row.action in ('GATE_DISABLE','GATE_DISABLE_ALL') then
      v_override_ttl := case when v_row.payload ? 'ttl_seconds' then (v_row.payload->>'ttl_seconds')::integer else null end;
      v_expires_at := case when v_override_ttl is null then null else clock_timestamp()+make_interval(secs=>v_override_ttl) end;
      insert into public.compute_fabric_a2_owner_gate_override_h205f22(
        workspace_id,gate_id,override_id,reason,disabled_at,expires_at,source_command_id,authority_effect
      ) values (
        p_workspace_id,v_gate_id,v_override_id,v_reason,clock_timestamp(),v_expires_at,v_row.command_id,false
      ) on conflict (workspace_id,gate_id) do update set
        override_id=excluded.override_id,reason=excluded.reason,disabled_at=excluded.disabled_at,
        expires_at=excluded.expires_at,source_command_id=excluded.source_command_id,authority_effect=false;
    elsif v_row.action='GATE_ENABLE' then
      delete from public.compute_fabric_a2_owner_gate_override_h205f22
       where workspace_id=p_workspace_id and gate_id=v_gate_id;
    else
      delete from public.compute_fabric_a2_owner_gate_override_h205f22
       where workspace_id=p_workspace_id;
    end if;
  end if;

  if found then return jsonb_build_object(
    'accepted',true,'status',v_row.status,'authority_effect',v_row.authority_effect,
    'owner_gate_registry_updated',coalesce(p_ok,false) and v_row.action in ('GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL')
  ); end if;

  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id and command_id=p_command_id;
  if v_row.status='LEASED' and v_row.leased_by=v_client then
    return jsonb_build_object('accepted',false,'status','EXPIRED','error','supervisor_lease_expired','authority_effect',false);
  end if;
  return jsonb_build_object('accepted',false,'status',v_row.status,'error','supervisor_lease_not_current','authority_effect',false);
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_v5(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_complete_v7(uuid,uuid,text,boolean,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v5(uuid,text,text,integer) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_complete_v7(uuid,uuid,text,boolean,jsonb,text,boolean) to service_role;

comment on table public.compute_fabric_a2_owner_gate_override_h205f22
is 'Durable owner-controlled project safety gate overrides. Wildcard * applies to all METAENGINE-internal gates. No page/model data grants authority.';
comment on function public.h205f22_a2_owner_gate_disabled_v1(uuid,text)
is 'Read-only owner gate decision helper. Returns true for an active exact or wildcard project-internal override.';
comment on function public.h205f22_a2_browser_supervisor_lease_v5(uuid,text,text,integer)
is 'Supervisor lease v5. Honors owner overrides for action budget, failure circuit and control-mode server gates while owner gate commands remain root/emergency.';
comment on function public.h205f22_a2_browser_supervisor_complete_v7(uuid,uuid,text,boolean,jsonb,text,boolean)
is 'Supervisor completion v7 atomically mirrors successful owner gate changes into the durable Supabase gate registry.';
