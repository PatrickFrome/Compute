-- METAENGINE Client V1 fresh-project bootstrap.
-- Reconstructs only the Browser/DevOS durable substrate required by the current
-- native supervisor. It intentionally does not recreate historical Compute Fabric
-- continuity/ME2 state and grants no Browser/page authority.

create schema if not exists destruktion_meta;

create table if not exists destruktion_meta.devos_fleet_task_h205f22 (
  task_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  point_id text not null,
  role text not null,
  claim_class text not null default 'MUTATING',
  base_sha text not null,
  branch_name text,
  task_spec jsonb not null default '{}'::jsonb,
  task_spec_sha256 text not null,
  idempotency_key text not null,
  priority integer not null default 50,
  state text not null default 'READY',
  lease_generation bigint not null default 0,
  lease_agent_id text,
  lease_tab_id text,
  lease_target_id text,
  lease_agent_generation_epoch bigint,
  lease_expires_at timestamptz,
  result_checkpoint_id text,
  result_summary jsonb,
  result_summary_sha256 text,
  result_sha256 text,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  authority_effect boolean not null default false check (authority_effect=false),
  constraint devos_fleet_task_idempotency_uq unique(workspace_id,idempotency_key),
  constraint devos_fleet_task_state_ck check (state in ('READY','LEASED','RUNNING','RESULT_READY','COMPLETED','FAILED','AMBIGUOUS','FENCED'))
);

create index if not exists devos_fleet_task_ready_idx
  on destruktion_meta.devos_fleet_task_h205f22(workspace_id,role,state,priority desc,created_at,task_id);
create index if not exists devos_fleet_task_lease_idx
  on destruktion_meta.devos_fleet_task_h205f22(workspace_id,state,lease_expires_at);

create table if not exists destruktion_meta.devos_fleet_claim_h205f22 (
  claim_id bigint generated always as identity primary key,
  task_id uuid not null references destruktion_meta.devos_fleet_task_h205f22(task_id),
  workspace_id uuid not null,
  point_id text not null,
  base_sha text not null,
  role text not null,
  claim_class text not null,
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  lease_generation bigint not null,
  state text not null default 'ACTIVE',
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check(authority_effect=false),
  constraint devos_fleet_claim_state_ck check(state in ('ACTIVE','EXPIRED','CLOSED','FENCED'))
);
create index if not exists devos_fleet_claim_active_idx
  on destruktion_meta.devos_fleet_claim_h205f22(workspace_id,state,expires_at);
create index if not exists devos_fleet_claim_task_idx
  on destruktion_meta.devos_fleet_claim_h205f22(task_id,lease_generation);

create table if not exists destruktion_meta.devos_fleet_event_h205f22 (
  event_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  event_type text not null,
  task_id uuid,
  point_id text,
  role text,
  agent_id text,
  lease_generation bigint,
  base_sha text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check(authority_effect=false)
);
create index if not exists devos_fleet_event_workspace_idx
  on destruktion_meta.devos_fleet_event_h205f22(workspace_id,event_id desc);

create or replace function destruktion_meta.devos_emit_event_h205f22(
  p_workspace uuid,p_event_type text,p_task uuid,p_point text,p_role text,p_agent text,
  p_generation bigint,p_base text,p_payload jsonb,p_idempotency_key text
) returns bigint
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_id bigint;
begin
  insert into destruktion_meta.devos_fleet_event_h205f22(
    workspace_id,event_type,task_id,point_id,role,agent_id,lease_generation,base_sha,payload,idempotency_key,authority_effect
  ) values (
    p_workspace,left(coalesce(p_event_type,''),160),p_task,p_point,p_role,p_agent,p_generation,p_base,
    coalesce(p_payload,'{}'::jsonb),left(coalesce(p_idempotency_key,''),512),false
  )
  on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning event_id into v_id;
  return v_id;
end $$;

create or replace function public.devos_fleet_enqueue_v1(
  p_workspace uuid,p_point text,p_role text,p_base text,p_spec jsonb,p_key text,
  p_branch text default null,p_priority integer default 50
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare v_task uuid; v_sha text;
begin
  if p_workspace is null or nullif(btrim(coalesce(p_point,'')),'') is null
     or nullif(btrim(coalesce(p_role,'')),'') is null
     or coalesce(p_base,'') !~ '^[0-9a-f]{40}$'
     or nullif(btrim(coalesce(p_key,'')),'') is null
     or jsonb_typeof(coalesce(p_spec,'{}'::jsonb)) <> 'object'
  then raise exception 'devos_enqueue_invalid' using errcode='22023'; end if;
  v_sha:=encode(extensions.digest(convert_to(coalesce(p_spec,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
  insert into destruktion_meta.devos_fleet_task_h205f22(
    workspace_id,point_id,role,claim_class,base_sha,branch_name,task_spec,task_spec_sha256,
    idempotency_key,priority,state,authority_effect
  ) values (
    p_workspace,left(p_point,240),upper(left(p_role,80)),
    upper(coalesce(nullif(p_spec->>'claim_class',''),'MUTATING')),
    lower(p_base),nullif(left(coalesce(p_branch,''),240),''),
    coalesce(p_spec,'{}'::jsonb),v_sha,left(p_key,512),greatest(0,least(1000,coalesce(p_priority,50))),
    'READY',false
  )
  on conflict(workspace_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning task_id into v_task;
  perform destruktion_meta.devos_emit_event_h205f22(
    p_workspace,'TASK_ENQUEUED',v_task,p_point,upper(p_role),null,0,lower(p_base),
    jsonb_build_object('task_spec_sha256',v_sha,'automatic_retry_allowed',false,'authority_effect',false),
    left(p_key,512)||':enqueue'
  );
  return jsonb_build_object('accepted',true,'enqueued',true,'task_id',v_task,'task_spec_sha256',v_sha,
    'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create or replace function public.devos_fleet_reconcile_v1(p_workspace uuid)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_now timestamptz:=clock_timestamp(); v_tasks bigint:=0; v_claims bigint:=0;
begin
  update destruktion_meta.devos_fleet_task_h205f22
     set state='AMBIGUOUS',error_code='LEASE_EXPIRED_EFFECT_UNKNOWN',updated_at=v_now
   where workspace_id=p_workspace and state in ('LEASED','RUNNING')
     and lease_expires_at is not null and lease_expires_at<=v_now;
  get diagnostics v_tasks=row_count;
  update destruktion_meta.devos_fleet_claim_h205f22
     set state='EXPIRED',updated_at=v_now
   where workspace_id=p_workspace and state='ACTIVE' and expires_at<=v_now;
  get diagnostics v_claims=row_count;
  return jsonb_build_object('schema','metaengine.devos.fleet-reconcile.v1','workspace_id',p_workspace,
    'expired_tasks_fenced_ambiguous',v_tasks,'expired_claims',v_claims,'requeued_tasks',0,
    'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create or replace function public.devos_fleet_snapshot_v1(p_workspace uuid)
returns jsonb language sql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
select jsonb_build_object(
 'schema','metaengine.devos.fleet-snapshot.v1','workspace_id',p_workspace,
 'active_tasks',coalesce((select jsonb_agg(jsonb_build_object(
   'task_id',t.task_id,'point_id',t.point_id,'role',t.role,'claim_class',t.claim_class,
   'base_sha',t.base_sha,'branch_name',t.branch_name,'state',t.state,'priority',t.priority,
   'lease_generation',t.lease_generation,'lease_agent_id',t.lease_agent_id,
   'lease_tab_id',t.lease_tab_id,'lease_target_id',t.lease_target_id,
   'lease_agent_generation_epoch',t.lease_agent_generation_epoch,'lease_expires_at',t.lease_expires_at,
   'task_spec_sha256',t.task_spec_sha256,'created_at',t.created_at,'updated_at',t.updated_at
 ) order by t.priority desc,t.created_at,t.task_id)
 from destruktion_meta.devos_fleet_task_h205f22 t
 where t.workspace_id=p_workspace and t.state not in ('COMPLETED','FAILED','FENCED')),'[]'::jsonb),
 'active_claims',coalesce((select jsonb_agg(to_jsonb(c) - 'authority_effect' order by c.claim_id)
 from destruktion_meta.devos_fleet_claim_h205f22 c
 where c.workspace_id=p_workspace and c.state='ACTIVE'),'[]'::jsonb),
 'recent_events',coalesce((select jsonb_agg(x.row_value order by x.event_id desc)
 from (select e.event_id,to_jsonb(e)-'authority_effect' row_value
       from destruktion_meta.devos_fleet_event_h205f22 e
       where e.workspace_id=p_workspace order by e.event_id desc limit 64) x),'[]'::jsonb),
 'automatic_retry_allowed',false,'authority_effect',false);
$$;

create or replace function public.devos_fleet_lease_v1(
 p_workspace uuid,p_agent text,p_role text,p_tab text,p_target text,p_epoch bigint,p_seconds integer default 900
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_claim bigint;
 v_now timestamptz:=clock_timestamp(); v_secs int:=greatest(60,least(3600,coalesce(p_seconds,900)));
begin
 perform public.devos_fleet_reconcile_v1(p_workspace);
 with picked as (
   select task_id from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id=p_workspace and state='READY' and role=upper(p_role)
   order by priority desc,created_at,task_id for update skip locked limit 1
 )
 update destruktion_meta.devos_fleet_task_h205f22 t
 set state='LEASED',lease_generation=t.lease_generation+1,lease_agent_id=lower(p_agent),
     lease_tab_id=p_tab,lease_target_id=lower(p_target),lease_agent_generation_epoch=p_epoch,
     lease_expires_at=v_now+make_interval(secs=>v_secs),updated_at=v_now
 from picked p where t.task_id=p.task_id returning t.* into v_task;
 if not found then return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'automatic_retry_allowed',false,'authority_effect',false); end if;
 insert into destruktion_meta.devos_fleet_claim_h205f22(
  task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,
  agent_generation_epoch,lease_generation,expires_at
 ) values (
  v_task.task_id,v_task.workspace_id,v_task.point_id,v_task.base_sha,v_task.role,v_task.claim_class,
  lower(p_agent),p_tab,lower(p_target),p_epoch,v_task.lease_generation,v_task.lease_expires_at
 ) returning claim_id into v_claim;
 return jsonb_build_object('leased',true,'task_id',v_task.task_id,'claim_id',v_claim,'point_id',v_task.point_id,
  'role',v_task.role,'claim_class',v_task.claim_class,'base_sha',v_task.base_sha,'branch_name',v_task.branch_name,
  'task_spec',v_task.task_spec,'task_spec_sha256',v_task.task_spec_sha256,'lease_generation',v_task.lease_generation,
  'lease_expires_at',v_task.lease_expires_at,'agent_id',lower(p_agent),'tab_id',p_tab,'target_id',lower(p_target),
  'agent_generation_epoch',p_epoch,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create or replace function public.devos_fleet_mark_running_v1(
 p_task uuid,p_agent text,p_generation bigint,p_tab text,p_target text,p_epoch bigint,p_proof jsonb
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
begin
 select * into v_task from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task for update;
 if not found or v_task.state<>'LEASED' or v_task.lease_agent_id<>lower(p_agent)
    or v_task.lease_generation<>p_generation or v_task.lease_tab_id<>p_tab
    or v_task.lease_target_id<>lower(p_target) or v_task.lease_agent_generation_epoch<>p_epoch
    or v_task.lease_expires_at<=clock_timestamp() then raise exception 'task_lease_fenced'; end if;
 update destruktion_meta.devos_fleet_task_h205f22 set state='RUNNING',updated_at=clock_timestamp() where task_id=p_task;
 return jsonb_build_object('task_id',p_task,'state','RUNNING','automatic_retry_allowed',false,'authority_effect',false);
end $$;

create or replace function public.devos_fleet_complete_v1(
 p_task uuid,p_agent text,p_generation bigint,p_tab text,p_target text,p_epoch bigint,
 p_state text,p_summary jsonb,p_error text default null
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_now timestamptz:=clock_timestamp();
 v_final text:=upper(coalesce(p_state,'')); v_summary jsonb:=coalesce(p_summary,'{}'::jsonb); v_sha text;
begin
 if v_final not in ('COMPLETED','FAILED','RESULT_READY') or jsonb_typeof(v_summary)<>'object'
 then raise exception 'devos_complete_invalid' using errcode='22023'; end if;
 select * into v_task from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task for update;
 if not found or v_task.state<>'RUNNING' or v_task.lease_agent_id<>lower(p_agent)
    or v_task.lease_generation<>p_generation or v_task.lease_tab_id<>p_tab
    or v_task.lease_target_id<>lower(p_target) or v_task.lease_agent_generation_epoch<>p_epoch
    or v_task.lease_expires_at<=v_now then raise exception 'task_lease_fenced'; end if;
 v_sha:=encode(extensions.digest(convert_to(v_summary::text,'UTF8'),'sha256'),'hex');
 update destruktion_meta.devos_fleet_task_h205f22
    set state=v_final,result_summary=v_summary,result_summary_sha256=v_sha,result_sha256=v_sha,
        error_code=nullif(left(coalesce(p_error,''),160),''),finished_at=case when v_final in ('COMPLETED','FAILED') then v_now else null end,
        updated_at=v_now
  where task_id=p_task;
 update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED',updated_at=v_now
  where task_id=p_task and lease_generation=p_generation and state='ACTIVE';
 return jsonb_build_object('task_id',p_task,'state',v_final,'result_sha256',v_sha,
   'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create table if not exists public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
 workspace_id uuid not null,
 supervisor_instance_id text not null,
 conversation_url_sha256 text not null,
 tab_id text,
 status text not null,
 priority integer not null default 100,
 capabilities jsonb not null default '{}'::jsonb,
 registered_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz,
 authority_effect boolean not null default false check(authority_effect=false),
 primary key(workspace_id,supervisor_instance_id)
);
create index if not exists a2_supervisor_mesh_fresh_idx
 on public.compute_fabric_a2_supervisor_mesh_instance_h205f22(workspace_id,status,last_seen_at desc);

create table if not exists public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
 lease_id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null,
 target_client_id text not null,
 holder_supervisor_instance_id text not null,
 effect_scope text not null,
 effect_key text not null,
 status text not null,
 command_id uuid,
 acquired_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 released_at timestamptz,
 release_reason text,
 authority_effect boolean not null default false check(authority_effect=false)
);
create unique index if not exists a2_supervisor_actuation_active_client_uq
 on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id,target_client_id)
 where status='ACTIVE';
create index if not exists a2_supervisor_actuation_holder_idx
 on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id,holder_supervisor_instance_id);

create table if not exists destruktion_meta.devos_fleet_runtime_control_h205f22 (
 workspace_id uuid primary key,
 generation_floor bigint not null default 0 check(generation_floor>=0),
 refill_enabled boolean not null default false,
 supervisor_admission_enabled boolean not null default false,
 reset_at timestamptz,
 reset_reason text,
 updated_at timestamptz not null default clock_timestamp(),
 authority_effect boolean not null default false check(authority_effect=false)
);

create or replace function public.devos_environment_state_v1(p_workspace uuid)
returns jsonb language sql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
 select jsonb_build_object('schema','metaengine.devos.environment-state.v1','workspace_id',p_workspace,
  'generation_floor',coalesce(c.generation_floor,0),'refill_enabled',coalesce(c.refill_enabled,false),
  'supervisor_admission_enabled',coalesce(c.supervisor_admission_enabled,false),
  'reset_at',c.reset_at,'reset_reason',c.reset_reason,'authority_effect',false)
 from (select 1) x left join destruktion_meta.devos_fleet_runtime_control_h205f22 c on c.workspace_id=p_workspace;
$$;

alter table destruktion_meta.devos_fleet_task_h205f22 enable row level security;
alter table destruktion_meta.devos_fleet_claim_h205f22 enable row level security;
alter table destruktion_meta.devos_fleet_event_h205f22 enable row level security;
alter table destruktion_meta.devos_fleet_runtime_control_h205f22 enable row level security;
alter table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 enable row level security;
alter table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 enable row level security;

revoke all on table destruktion_meta.devos_fleet_task_h205f22,destruktion_meta.devos_fleet_claim_h205f22,
 destruktion_meta.devos_fleet_event_h205f22,destruktion_meta.devos_fleet_runtime_control_h205f22,
 public.compute_fabric_a2_supervisor_mesh_instance_h205f22,public.compute_fabric_a2_supervisor_actuation_lease_h205f22
 from public,anon,authenticated;
grant select,insert,update,delete on table destruktion_meta.devos_fleet_task_h205f22,
 destruktion_meta.devos_fleet_claim_h205f22,destruktion_meta.devos_fleet_event_h205f22,
 destruktion_meta.devos_fleet_runtime_control_h205f22,public.compute_fabric_a2_supervisor_mesh_instance_h205f22,
 public.compute_fabric_a2_supervisor_actuation_lease_h205f22 to service_role;

revoke all on function destruktion_meta.devos_emit_event_h205f22(uuid,text,uuid,text,text,text,bigint,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.devos_fleet_enqueue_v1(uuid,text,text,text,jsonb,text,text,integer) from public,anon,authenticated;
revoke all on function public.devos_fleet_reconcile_v1(uuid) from public,anon,authenticated;
revoke all on function public.devos_fleet_snapshot_v1(uuid) from public,anon,authenticated;
revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.devos_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.devos_fleet_complete_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.devos_environment_state_v1(uuid) from public,anon,authenticated;

grant execute on function public.devos_fleet_enqueue_v1(uuid,text,text,text,jsonb,text,text,integer),
 public.devos_fleet_reconcile_v1(uuid),public.devos_fleet_snapshot_v1(uuid),
 public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer),
 public.devos_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb),
 public.devos_fleet_complete_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text),
 public.devos_environment_state_v1(uuid) to service_role;
