-- A2 Browser Supervisor v3: authenticated remote authority bootstrap.
-- v1/v2 RPCs remain available for rollback compatibility.

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_action_ck;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add constraint a2_browser_supervisor_command_action_ck
  check (action in (
    'ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE',
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT'
  ));

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop constraint if exists a2_browser_supervisor_command_no_authority_ck;

alter table public.compute_fabric_a2_browser_supervisor_state_h205f22
  drop constraint if exists a2_browser_supervisor_state_no_authority_ck;

comment on column public.compute_fabric_a2_browser_supervisor_command_h205f22.authority_effect is
  'True only after a completed supervisor command changed browser/operator authority or state; false for pending/read-only commands.';

comment on column public.compute_fabric_a2_browser_supervisor_state_h205f22.authority_effect is
  'Current extension authority surface: true when supervisor CONTROL is active or Browser Operator is armed.';

create or replace function public.h205f22_a2_browser_supervisor_enqueue_v3(
  p_workspace_id uuid,
  p_action text,
  p_platform text default null,
  p_payload jsonb default '{}'::jsonb,
  p_target_client_id text default null,
  p_ttl_seconds integer default 300,
  p_issued_by text default 'CONNECTED_CHAT_SUPERVISOR',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
begin
  if v_action not in ('ARM','DISARM','SET_SUPERVISOR_MODE','SET_MODE','POLL','CAPTURE','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT') then
    raise exception 'supervisor_action_invalid';
  end if;
  if v_platform is not null and v_platform not in ('CHATGPT','GLM_ZAI') then
    raise exception 'supervisor_platform_invalid';
  end if;
  if length(v_key) not between 16 and 160 or v_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'supervisor_idempotency_key_invalid';
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
    'command_id',v_row.command_id,
    'status',v_row.status,
    'action',v_row.action,
    'platform',v_row.platform,
    'idempotency_key',v_row.idempotency_key,
    'replayed',v_id is null,
    'authority_effect',v_row.authority_effect
  );
end;
$$;

create or replace function public.h205f22_a2_browser_supervisor_lease_v3(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF',
  p_lease_timeout_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_mode text := upper(coalesce(p_supervisor_mode,'OFF'));
  v_lease_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds,120)));
begin
  if v_client = '' then raise exception 'supervisor_client_id_required'; end if;
  if v_mode not in ('OFF','MONITOR','CONTROL') then raise exception 'supervisor_mode_invalid'; end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=clock_timestamp(), error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at <= clock_timestamp();

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=clock_timestamp(), error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id
     and status='LEASED'
     and (expires_at <= clock_timestamp() or leased_at is null
          or leased_at <= clock_timestamp() - make_interval(secs=>v_lease_timeout));

  select * into v_row
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id
    and status='PENDING'
    and expires_at > clock_timestamp()
    and (target_client_id is null or target_client_id=v_client)
    and (v_mode='CONTROL' or action in ('SET_SUPERVISOR_MODE','ARM','DISARM'))
  order by issued_at asc
  for update skip locked
  limit 1;

  if not found then return jsonb_build_object('command',null); end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='LEASED', leased_by=v_client, leased_at=clock_timestamp()
   where command_id=v_row.command_id;

  return jsonb_build_object('command',jsonb_build_object(
    'command_id',v_row.command_id,
    'idempotency_key',v_row.idempotency_key,
    'action',v_row.action,
    'platform',v_row.platform,
    'payload',v_row.payload,
    'issued_at',v_row.issued_at,
    'expires_at',v_row.expires_at,
    'issued_by',v_row.issued_by,
    'authority_effect',false
  ));
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_enqueue_v3(uuid,text,text,jsonb,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_enqueue_v3(uuid,text,text,jsonb,text,integer,text,text) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer) to service_role;