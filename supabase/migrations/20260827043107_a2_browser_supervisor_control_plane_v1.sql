-- A2 Browser Operator Supervisor Control Plane v1
-- Applied live in Supabase as migration a2_browser_supervisor_control_plane_v1.

create table if not exists public.compute_fabric_a2_browser_supervisor_command_h205f22 (
  command_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  target_client_id text null,
  issued_by text not null,
  action text not null,
  platform text null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  leased_by text null,
  leased_at timestamptz null,
  completed_at timestamptz null,
  receipt jsonb null,
  error text null,
  authority_effect boolean not null default false,
  constraint a2_browser_supervisor_command_action_ck check (action in ('ARM','DISARM','SET_MODE','POLL','CAPTURE','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT')),
  constraint a2_browser_supervisor_command_platform_ck check (platform is null or platform in ('CHATGPT','GLM_ZAI')),
  constraint a2_browser_supervisor_command_status_ck check (status in ('PENDING','LEASED','COMPLETED','FAILED','EXPIRED','CANCELLED')),
  constraint a2_browser_supervisor_command_no_authority_ck check (authority_effect = false)
);
create index if not exists compute_fabric_a2_browser_supervisor_command_pending_idx on public.compute_fabric_a2_browser_supervisor_command_h205f22(status,issued_at) where status in ('PENDING','LEASED');

create table if not exists public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  client_id text primary key,
  workspace_id uuid not null,
  last_seen_at timestamptz not null default clock_timestamp(),
  extension_version text null,
  operator_runtime text null,
  supervisor_mode text not null default 'OFF',
  armed boolean not null default false,
  operator_mode text null,
  ordering_policy text null,
  last_command_id uuid null,
  last_command_status text null,
  state jsonb not null default '{}'::jsonb,
  authority_effect boolean not null default false,
  constraint a2_browser_supervisor_state_mode_ck check (supervisor_mode in ('OFF','MONITOR','CONTROL')),
  constraint a2_browser_supervisor_state_no_authority_ck check (authority_effect = false)
);
create index if not exists compute_fabric_a2_browser_supervisor_state_seen_idx on public.compute_fabric_a2_browser_supervisor_state_h205f22(last_seen_at desc);

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22 enable row level security;
alter table public.compute_fabric_a2_browser_supervisor_state_h205f22 enable row level security;
revoke all on public.compute_fabric_a2_browser_supervisor_command_h205f22 from public,anon,authenticated;
revoke all on public.compute_fabric_a2_browser_supervisor_state_h205f22 from public,anon,authenticated;
grant select,insert,update on public.compute_fabric_a2_browser_supervisor_command_h205f22 to service_role;
grant select,insert,update on public.compute_fabric_a2_browser_supervisor_state_h205f22 to service_role;

create or replace function public.h205f22_a2_browser_supervisor_enqueue_v1(
  p_workspace_id uuid,p_action text,p_platform text default null,p_payload jsonb default '{}'::jsonb,
  p_target_client_id text default null,p_ttl_seconds integer default 300,p_issued_by text default 'CONNECTED_CHAT_SUPERVISOR'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_action text:=upper(coalesce(p_action,''));v_platform text:=nullif(upper(coalesce(p_platform,'')),'');v_ttl integer:=greatest(30,least(1800,coalesce(p_ttl_seconds,300)));
begin
  if v_action not in ('ARM','DISARM','SET_MODE','POLL','CAPTURE','STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT') then raise exception 'supervisor_action_invalid'; end if;
  if v_platform is not null and v_platform not in ('CHATGPT','GLM_ZAI') then raise exception 'supervisor_platform_invalid'; end if;
  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(workspace_id,target_client_id,issued_by,action,platform,payload,expires_at,authority_effect)
  values(p_workspace_id,nullif(trim(coalesce(p_target_client_id,'')),''),left(coalesce(p_issued_by,'CONNECTED_CHAT_SUPERVISOR'),160),v_action,v_platform,coalesce(p_payload,'{}'::jsonb),clock_timestamp()+make_interval(secs=>v_ttl),false)
  returning command_id into v_id;
  return jsonb_build_object('command_id',v_id,'status','PENDING','action',v_action,'platform',v_platform,'authority_effect',false);
end;$$;

create or replace function public.h205f22_a2_browser_supervisor_lease_v1(p_workspace_id uuid,p_client_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;v_client text:=left(trim(coalesce(p_client_id,'')),160);
begin
  if v_client='' then raise exception 'supervisor_client_id_required'; end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='EXPIRED',completed_at=clock_timestamp(),error='command_expired_before_lease' where workspace_id=p_workspace_id and status='PENDING' and expires_at<=clock_timestamp();
  select * into v_row from public.compute_fabric_a2_browser_supervisor_command_h205f22 where workspace_id=p_workspace_id and status='PENDING' and expires_at>clock_timestamp() and (target_client_id is null or target_client_id=v_client) order by issued_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('command',null); end if;
  update public.compute_fabric_a2_browser_supervisor_command_h205f22 set status='LEASED',leased_by=v_client,leased_at=clock_timestamp() where command_id=v_row.command_id;
  return jsonb_build_object('command',jsonb_build_object('command_id',v_row.command_id,'action',v_row.action,'platform',v_row.platform,'payload',v_row.payload,'issued_at',v_row.issued_at,'expires_at',v_row.expires_at,'issued_by',v_row.issued_by,'authority_effect',false));
end;$$;

revoke all on function public.h205f22_a2_browser_supervisor_enqueue_v1(uuid,text,text,jsonb,text,integer,text) from public,anon,authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_lease_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_enqueue_v1(uuid,text,text,jsonb,text,integer,text) to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v1(uuid,text) to service_role;
