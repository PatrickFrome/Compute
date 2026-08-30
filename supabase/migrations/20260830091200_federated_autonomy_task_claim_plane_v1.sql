-- METAENGINE Browser Fleet Federated Autonomy task/claim plane v1.
-- Branch-local PREPARE_ONLY migration. No roadmap/mainline authority is granted here.
-- Reuses the AOP1 lease-generation + append-only-event pattern while binding every
-- leased task to the exact Browser fleet agent incarnation.

create table if not exists destruktion_meta.compute_fabric_browser_fleet_task_h205f22 (
  task_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 160),
  point_id text not null check (point_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'),
  role text not null check (role ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  claim_class text not null check (claim_class in ('MUTATING','ADVISORY')),
  base_sha text not null check (base_sha ~ '^[0-9a-f]{40}$'),
  branch_name text null check (branch_name is null or (char_length(branch_name) between 3 and 240 and branch_name !~ '[[:space:]]')),
  priority integer not null default 50 check (priority between 0 and 100),
  task_spec jsonb not null check (jsonb_typeof(task_spec)='object' and octet_length(task_spec::text)<=131072),
  task_spec_sha256 text not null check (task_spec_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'READY' check (state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED','AMBIGUOUS','COMPLETED','FAILED','CANCELLED','FENCED')),
  lease_owner text null,
  lease_generation bigint not null default 0 check (lease_generation>=0),
  lease_agent_id text null,
  lease_tab_id text null,
  lease_target_id text null,
  lease_agent_generation_epoch bigint null,
  lease_expires_at timestamptz null,
  result_summary jsonb null check (result_summary is null or (jsonb_typeof(result_summary)='object' and octet_length(result_summary::text)<=131072)),
  result_sha256 text null check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text null,
  created_by text not null default 'METAENGINE_SUPERVISOR' check (char_length(created_by) between 3 and 160),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz null,
  check (
    (state='READY' and lease_owner is null and lease_agent_id is null and lease_tab_id is null and lease_target_id is null and lease_agent_generation_epoch is null and lease_expires_at is null)
    or state<>'READY'
  )
);

create unique index if not exists compute_fabric_browser_fleet_one_mutator_point_uq
  on destruktion_meta.compute_fabric_browser_fleet_task_h205f22(workspace_id,point_id,base_sha)
  where claim_class='MUTATING' and state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED','AMBIGUOUS');
create index if not exists compute_fabric_browser_fleet_task_ready_idx
  on destruktion_meta.compute_fabric_browser_fleet_task_h205f22(workspace_id,state,role,priority desc,created_at,task_id);

create table if not exists destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 (
  claim_id bigint generated always as identity primary key,
  task_id uuid not null references destruktion_meta.compute_fabric_browser_fleet_task_h205f22(task_id),
  workspace_id uuid not null,
  point_id text not null,
  base_sha text not null,
  role text not null,
  claim_class text not null check (claim_class in ('MUTATING','ADVISORY')),
  agent_id text not null check (agent_id ~ '^agent_[a-z0-9-]{8,64}$'),
  tab_id text not null check (char_length(tab_id) between 8 and 160),
  target_id text not null check (target_id ~ '^webcontents:[0-9]+$'),
  agent_generation_epoch bigint not null check (agent_generation_epoch>=1),
  lease_generation bigint not null check (lease_generation>=1),
  state text not null default 'ACTIVE' check (state in ('ACTIVE','RELEASED','EXPIRED','FENCED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);
create unique index if not exists compute_fabric_browser_fleet_one_active_claim_per_task_uq
  on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22(task_id) where state='ACTIVE';
create unique index if not exists compute_fabric_browser_fleet_one_active_task_per_agent_uq
  on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22(workspace_id,agent_id) where state='ACTIVE';
create unique index if not exists compute_fabric_browser_fleet_one_active_mutator_claim_uq
  on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22(workspace_id,point_id,base_sha)
  where claim_class='MUTATING' and state='ACTIVE';

create table if not exists destruktion_meta.compute_fabric_browser_fleet_event_h205f22 (
  event_id bigint generated always as identity primary key,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  workspace_id uuid not null,
  task_id uuid null references destruktion_meta.compute_fabric_browser_fleet_task_h205f22(task_id),
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  point_id text null,
  role text null,
  agent_id text null,
  lease_generation bigint null,
  base_sha text null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_included boolean not null default false check (prompt_included=false),
  page_data_authority boolean not null default false check (page_data_authority=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists compute_fabric_browser_fleet_event_task_idx
  on destruktion_meta.compute_fabric_browser_fleet_event_h205f22(workspace_id,task_id,event_id desc);
create index if not exists compute_fabric_browser_fleet_event_point_idx
  on destruktion_meta.compute_fabric_browser_fleet_event_h205f22(workspace_id,point_id,event_id desc);

alter table destruktion_meta.compute_fabric_browser_fleet_task_h205f22 enable row level security;
alter table destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 enable row level security;
alter table destruktion_meta.compute_fabric_browser_fleet_event_h205f22 enable row level security;

do $$ begin
  create policy compute_fabric_browser_fleet_task_deny_clients on destruktion_meta.compute_fabric_browser_fleet_task_h205f22
    for all to anon,authenticated using(false) with check(false);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy compute_fabric_browser_fleet_claim_deny_clients on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22
    for all to anon,authenticated using(false) with check(false);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy compute_fabric_browser_fleet_event_deny_clients on destruktion_meta.compute_fabric_browser_fleet_event_h205f22
    for all to anon,authenticated using(false) with check(false);
exception when duplicate_object then null; end $$;

revoke all on destruktion_meta.compute_fabric_browser_fleet_task_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_browser_fleet_event_h205f22 from public,anon,authenticated,service_role;

create or replace function destruktion_meta.compute_fabric_browser_fleet_event_immutable_h205f22()
returns trigger language plpgsql set search_path='pg_catalog' as $$
begin
  raise exception 'browser_fleet_event_is_append_only' using errcode='55000';
end $$;
drop trigger if exists compute_fabric_browser_fleet_event_immutable_trg on destruktion_meta.compute_fabric_browser_fleet_event_h205f22;
create trigger compute_fabric_browser_fleet_event_immutable_trg
before update or delete on destruktion_meta.compute_fabric_browser_fleet_event_h205f22
for each row execute function destruktion_meta.compute_fabric_browser_fleet_event_immutable_h205f22();

create or replace function destruktion_meta.compute_fabric_browser_fleet_terminal_task_guard_h205f22()
returns trigger language plpgsql set search_path='pg_catalog' as $$
begin
  if old.state in ('COMPLETED','FAILED','CANCELLED','FENCED') then
    raise exception 'browser_fleet_terminal_task_is_immutable' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists compute_fabric_browser_fleet_terminal_task_guard_trg on destruktion_meta.compute_fabric_browser_fleet_task_h205f22;
create trigger compute_fabric_browser_fleet_terminal_task_guard_trg
before update on destruktion_meta.compute_fabric_browser_fleet_task_h205f22
for each row execute function destruktion_meta.compute_fabric_browser_fleet_terminal_task_guard_h205f22();

create or replace function destruktion_meta.compute_fabric_browser_fleet_terminal_claim_guard_h205f22()
returns trigger language plpgsql set search_path='pg_catalog' as $$
begin
  if old.state in ('RELEASED','EXPIRED','FENCED') then
    raise exception 'browser_fleet_terminal_claim_is_immutable' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists compute_fabric_browser_fleet_terminal_claim_guard_trg on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22;
create trigger compute_fabric_browser_fleet_terminal_claim_guard_trg
before update on destruktion_meta.compute_fabric_browser_fleet_claim_h205f22
for each row execute function destruktion_meta.compute_fabric_browser_fleet_terminal_claim_guard_h205f22();

create or replace function destruktion_meta.compute_fabric_browser_fleet_emit_event_h205f22(
  p_workspace_id uuid,
  p_event_type text,
  p_task_id uuid default null,
  p_point_id text default null,
  p_role text default null,
  p_agent_id text default null,
  p_lease_generation bigint default null,
  p_base_sha text default null,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_sha text;
  v_key text;
  v_event_id bigint;
  v_inserted boolean := false;
begin
  if p_workspace_id is null then raise exception 'fleet_event_workspace_required' using errcode='22023'; end if;
  if coalesce(p_event_type,'') !~ '^[A-Z][A-Z0-9_]{2,95}$' then raise exception 'fleet_event_type_invalid' using errcode='22023'; end if;
  if jsonb_typeof(v_payload)<>'object' or octet_length(v_payload::text)>65536 then raise exception 'fleet_event_payload_invalid' using errcode='22023'; end if;
  if v_payload ? 'prompt' or v_payload ? 'text' or v_payload ? 'task_spec' then raise exception 'fleet_event_prompt_material_forbidden' using errcode='22023'; end if;
  v_sha := encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  v_key := coalesce(nullif(trim(p_idempotency_key),''), encode(extensions.digest(convert_to(jsonb_build_object(
    'workspace_id',p_workspace_id,'event_type',p_event_type,'task_id',p_task_id,'point_id',p_point_id,
    'role',p_role,'agent_id',p_agent_id,'lease_generation',p_lease_generation,'base_sha',p_base_sha,'payload_sha256',v_sha
  )::text,'UTF8'),'sha256'),'hex'));
  if char_length(v_key)<16 or char_length(v_key)>200 then raise exception 'fleet_event_idempotency_invalid' using errcode='22023'; end if;
  insert into destruktion_meta.compute_fabric_browser_fleet_event_h205f22(
    idempotency_key,workspace_id,task_id,event_type,point_id,role,agent_id,lease_generation,base_sha,payload,payload_sha256
  ) values (v_key,p_workspace_id,p_task_id,p_event_type,p_point_id,p_role,p_agent_id,p_lease_generation,p_base_sha,v_payload,v_sha)
  on conflict(idempotency_key) do nothing returning event_id into v_event_id;
  if v_event_id is not null then v_inserted:=true;
  else select event_id into v_event_id from destruktion_meta.compute_fabric_browser_fleet_event_h205f22 where idempotency_key=v_key;
  end if;
  return jsonb_build_object('schema','metaengine.browser.fleet-event.h205f22.v1','event_id',v_event_id,'event_type',p_event_type,
    'payload_sha256',v_sha,'duplicate',not v_inserted,'prompt_included',false,'page_data_authority',false,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_browser_fleet_enqueue_task_v1(
  p_workspace_id uuid,
  p_point_id text,
  p_role text,
  p_base_sha text,
  p_task_spec jsonb,
  p_idempotency_key text,
  p_branch_name text default null,
  p_priority integer default 50,
  p_created_by text default 'METAENGINE_SUPERVISOR'
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare
  v_role text := upper(trim(coalesce(p_role,'')));
  v_point text := lower(trim(coalesce(p_point_id,'')));
  v_base text := lower(trim(coalesce(p_base_sha,'')));
  v_key text := trim(coalesce(p_idempotency_key,''));
  v_spec jsonb := coalesce(p_task_spec,'{}'::jsonb);
  v_class text;
  v_sha text;
  v_task_id uuid;
  v_inserted boolean := false;
begin
  if p_workspace_id is null then raise exception 'fleet_task_workspace_required' using errcode='22023'; end if;
  if v_point !~ '^[a-z0-9][a-z0-9._:-]{2,127}$' then raise exception 'fleet_task_point_invalid' using errcode='22023'; end if;
  if v_role !~ '^[A-Z][A-Z0-9_]{2,63}$' then raise exception 'fleet_task_role_invalid' using errcode='22023'; end if;
  if v_base !~ '^[0-9a-f]{40}$' then raise exception 'fleet_task_base_sha_invalid' using errcode='22023'; end if;
  if char_length(v_key)<16 or char_length(v_key)>160 or v_key !~ '^[A-Za-z0-9._:-]+$' then raise exception 'fleet_task_idempotency_invalid' using errcode='22023'; end if;
  if jsonb_typeof(v_spec)<>'object' or octet_length(v_spec::text)>131072 then raise exception 'fleet_task_spec_invalid' using errcode='22023'; end if;
  if coalesce(p_priority,50) not between 0 and 100 then raise exception 'fleet_task_priority_invalid' using errcode='22023'; end if;
  v_class := case when v_role='IMPLEMENTER' then 'MUTATING' else 'ADVISORY' end;
  v_sha := encode(extensions.digest(convert_to(v_spec::text,'UTF8'),'sha256'),'hex');
  insert into destruktion_meta.compute_fabric_browser_fleet_task_h205f22(
    workspace_id,idempotency_key,point_id,role,claim_class,base_sha,branch_name,priority,task_spec,task_spec_sha256,created_by
  ) values (p_workspace_id,v_key,v_point,v_role,v_class,v_base,nullif(trim(coalesce(p_branch_name,'')),''),coalesce(p_priority,50),v_spec,v_sha,left(trim(coalesce(p_created_by,'METAENGINE_SUPERVISOR')),160))
  on conflict(idempotency_key) do nothing returning task_id into v_task_id;
  if v_task_id is not null then v_inserted:=true;
  else select task_id into v_task_id from destruktion_meta.compute_fabric_browser_fleet_task_h205f22 where idempotency_key=v_key;
  end if;
  perform destruktion_meta.compute_fabric_browser_fleet_emit_event_h205f22(
    p_workspace_id,'TASK_ENQUEUED',v_task_id,v_point,v_role,null,null,v_base,
    jsonb_build_object('claim_class',v_class,'task_spec_sha256',v_sha,'branch_name',nullif(trim(coalesce(p_branch_name,'')),'') ,'priority',coalesce(p_priority,50)),
    v_key||':event'
  );
  return jsonb_build_object('schema','metaengine.browser.fleet-task-enqueue.h205f22.v1','task_id',v_task_id,'point_id',v_point,'role',v_role,
    'claim_class',v_class,'base_sha',v_base,'task_spec_sha256',v_sha,'duplicate',not v_inserted,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_browser_fleet_lease_task_v1(
  p_workspace_id uuid,
  p_agent_id text,
  p_role text,
  p_tab_id text,
  p_target_id text,
  p_agent_generation_epoch bigint,
  p_lease_seconds integer default 180
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','destruktion_meta' as $$
declare
  v_agent text := lower(trim(coalesce(p_agent_id,'')));
  v_role text := upper(trim(coalesce(p_role,'')));
  v_tab text := trim(coalesce(p_tab_id,''));
  v_target text := lower(trim(coalesce(p_target_id,'')));
  v_epoch bigint := p_agent_generation_epoch;
  v_lease_seconds integer := greatest(30,least(900,coalesce(p_lease_seconds,180)));
  v_task destruktion_meta.compute_fabric_browser_fleet_task_h205f22%rowtype;
  v_claim_id bigint;
begin
  if p_workspace_id is null then raise exception 'fleet_lease_workspace_required' using errcode='22023'; end if;
  if v_agent !~ '^agent_[a-z0-9-]{8,64}$' then raise exception 'fleet_lease_agent_invalid' using errcode='22023'; end if;
  if v_role !~ '^[A-Z][A-Z0-9_]{2,63}$' then raise exception 'fleet_lease_role_invalid' using errcode='22023'; end if;
  if char_length(v_tab)<8 then raise exception 'fleet_lease_tab_invalid' using errcode='22023'; end if;
  if v_target !~ '^webcontents:[0-9]+$' then raise exception 'fleet_lease_target_invalid' using errcode='22023'; end if;
  if coalesce(v_epoch,0)<1 then raise exception 'fleet_lease_generation_epoch_invalid' using errcode='22023'; end if;

  -- An expired lease may have already caused a physical/model effect. Never requeue it blindly.
  update destruktion_meta.compute_fabric_browser_fleet_task_h205f22
     set state='AMBIGUOUS',error_code='LEASE_EXPIRED_EFFECT_UNKNOWN',updated_at=clock_timestamp()
   where workspace_id=p_workspace_id and state in ('LEASED','RUNNING') and lease_expires_at<=clock_timestamp();
  update destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 c
     set state='EXPIRED',updated_at=clock_timestamp()
   where c.workspace_id=p_workspace_id and c.state='ACTIVE' and c.expires_at<=clock_timestamp();

  with picked as (
    select t.task_id
      from destruktion_meta.compute_fabric_browser_fleet_task_h205f22 t
     where t.workspace_id=p_workspace_id and t.state='READY' and t.role=v_role
       and not exists (
         select 1 from destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 c
          where c.workspace_id=t.workspace_id and c.agent_id=v_agent and c.state='ACTIVE'
       )
       and (t.claim_class<>'MUTATING' or not exists (
         select 1 from destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 c
          where c.workspace_id=t.workspace_id and c.point_id=t.point_id and c.base_sha=t.base_sha
            and c.claim_class='MUTATING' and c.state='ACTIVE'
       ))
     order by t.priority desc,t.created_at,t.task_id
     for update of t skip locked limit 1
  )
  update destruktion_meta.compute_fabric_browser_fleet_task_h205f22 t
     set state='LEASED',lease_owner=v_agent,lease_generation=t.lease_generation+1,
         lease_agent_id=v_agent,lease_tab_id=v_tab,lease_target_id=v_target,lease_agent_generation_epoch=v_epoch,
         lease_expires_at=clock_timestamp()+make_interval(secs=>v_lease_seconds),updated_at=clock_timestamp()
    from picked p where t.task_id=p.task_id returning t.* into v_task;

  if not found then
    return jsonb_build_object('schema','metaengine.browser.fleet-task-lease.h205f22.v1','leased',false,'agent_id',v_agent,'role',v_role,'canonical',false,'authority_effect',false);
  end if;

  insert into destruktion_meta.compute_fabric_browser_fleet_claim_h205f22(
    task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at
  ) values (
    v_task.task_id,v_task.workspace_id,v_task.point_id,v_task.base_sha,v_task.role,v_task.claim_class,v_agent,v_tab,v_target,v_epoch,v_task.lease_generation,v_task.lease_expires_at
  ) returning claim_id into v_claim_id;

  perform destruktion_meta.compute_fabric_browser_fleet_emit_event_h205f22(
    v_task.workspace_id,'TASK_LEASED',v_task.task_id,v_task.point_id,v_task.role,v_agent,v_task.lease_generation,v_task.base_sha,
    jsonb_build_object('claim_id',v_claim_id,'claim_class',v_task.claim_class,'tab_id',v_tab,'target_id',v_target,'agent_generation_epoch',v_epoch,'lease_expires_at',v_task.lease_expires_at),
    v_task.idempotency_key||':lease:'||v_task.lease_generation::text
  );

  return jsonb_build_object('schema','metaengine.browser.fleet-task-lease.h205f22.v1','leased',true,
    'task_id',v_task.task_id,'claim_id',v_claim_id,'point_id',v_task.point_id,'role',v_task.role,'claim_class',v_task.claim_class,
    'base_sha',v_task.base_sha,'branch_name',v_task.branch_name,'task_spec',v_task.task_spec,'task_spec_sha256',v_task.task_spec_sha256,
    'lease_generation',v_task.lease_generation,'lease_expires_at',v_task.lease_expires_at,
    'agent_id',v_agent,'tab_id',v_tab,'target_id',v_target,'agent_generation_epoch',v_epoch,
    'page_data_authority',false,'automatic_retry_allowed',false,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_browser_fleet_mark_running_v1(
  p_task_id uuid,
  p_agent_id text,
  p_lease_generation bigint,
  p_tab_id text,
  p_target_id text,
  p_agent_generation_epoch bigint,
  p_transport_proof jsonb
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','destruktion_meta' as $$
declare
  v_task destruktion_meta.compute_fabric_browser_fleet_task_h205f22%rowtype;
  v_proof jsonb := coalesce(p_transport_proof,'{}'::jsonb);
begin
  if jsonb_typeof(v_proof)<>'object' then raise exception 'fleet_transport_proof_invalid' using errcode='22023'; end if;
  if coalesce(v_proof->>'prompt_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'fleet_transport_prompt_sha_invalid' using errcode='22023'; end if;
  if coalesce(v_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'fleet_transport_conversation_sha_invalid' using errcode='22023'; end if;
  if coalesce(v_proof->>'effect_state','') not in ('PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION') then raise exception 'fleet_transport_effect_not_proven' using errcode='55000'; end if;
  select * into v_task from destruktion_meta.compute_fabric_browser_fleet_task_h205f22 where task_id=p_task_id for update;
  if not found then raise exception 'fleet_task_not_found' using errcode='22023'; end if;
  if v_task.state<>'LEASED' or v_task.lease_owner is distinct from lower(trim(coalesce(p_agent_id,'')))
     or v_task.lease_generation<>p_lease_generation or v_task.lease_tab_id is distinct from trim(coalesce(p_tab_id,''))
     or v_task.lease_target_id is distinct from lower(trim(coalesce(p_target_id,'')))
     or v_task.lease_agent_generation_epoch is distinct from p_agent_generation_epoch
     or v_task.lease_expires_at<=clock_timestamp() then raise exception 'fleet_task_lease_fenced' using errcode='55000'; end if;
  update destruktion_meta.compute_fabric_browser_fleet_task_h205f22 set state='RUNNING',updated_at=clock_timestamp() where task_id=p_task_id;
  perform destruktion_meta.compute_fabric_browser_fleet_emit_event_h205f22(
    v_task.workspace_id,'TASK_TRANSPORT_PROVEN',v_task.task_id,v_task.point_id,v_task.role,v_task.lease_agent_id,v_task.lease_generation,v_task.base_sha,
    jsonb_build_object('prompt_sha256',v_proof->>'prompt_sha256','conversation_url_sha256',v_proof->>'conversation_url_sha256','effect_state',v_proof->>'effect_state'),
    v_task.idempotency_key||':transport:'||v_task.lease_generation::text
  );
  return jsonb_build_object('schema','metaengine.browser.fleet-task-running.h205f22.v1','task_id',p_task_id,'state','RUNNING','lease_generation',p_lease_generation,
    'automatic_retry_allowed',false,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_browser_fleet_complete_task_v1(
  p_task_id uuid,
  p_agent_id text,
  p_lease_generation bigint,
  p_tab_id text,
  p_target_id text,
  p_agent_generation_epoch bigint,
  p_result_state text,
  p_result_summary jsonb default '{}'::jsonb,
  p_result_sha256 text default null,
  p_error_code text default null
) returns jsonb
language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare
  v_task destruktion_meta.compute_fabric_browser_fleet_task_h205f22%rowtype;
  v_state text := upper(trim(coalesce(p_result_state,'')));
  v_summary jsonb := coalesce(p_result_summary,'{}'::jsonb);
  v_sha text;
  v_claim_state text;
begin
  if v_state not in ('RESULT_READY','BLOCKED','AMBIGUOUS','COMPLETED','FAILED') then raise exception 'fleet_result_state_invalid' using errcode='22023'; end if;
  if jsonb_typeof(v_summary)<>'object' or octet_length(v_summary::text)>131072 then raise exception 'fleet_result_summary_invalid' using errcode='22023'; end if;
  v_sha := coalesce(nullif(lower(trim(coalesce(p_result_sha256,''))),''), encode(extensions.digest(convert_to(v_summary::text,'UTF8'),'sha256'),'hex'));
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'fleet_result_sha_invalid' using errcode='22023'; end if;
  select * into v_task from destruktion_meta.compute_fabric_browser_fleet_task_h205f22 where task_id=p_task_id for update;
  if not found then raise exception 'fleet_task_not_found' using errcode='22023'; end if;
  if v_task.state not in ('LEASED','RUNNING','RESULT_READY','BLOCKED') or v_task.lease_owner is distinct from lower(trim(coalesce(p_agent_id,'')))
     or v_task.lease_generation<>p_lease_generation or v_task.lease_tab_id is distinct from trim(coalesce(p_tab_id,''))
     or v_task.lease_target_id is distinct from lower(trim(coalesce(p_target_id,'')))
     or v_task.lease_agent_generation_epoch is distinct from p_agent_generation_epoch
     or v_task.lease_expires_at<=clock_timestamp() then raise exception 'fleet_task_lease_fenced' using errcode='55000'; end if;
  if v_state in ('RESULT_READY','COMPLETED') and v_task.state='LEASED' then raise exception 'fleet_transport_proof_required_before_result' using errcode='55000'; end if;
  update destruktion_meta.compute_fabric_browser_fleet_task_h205f22
     set state=v_state,result_summary=v_summary,result_sha256=v_sha,error_code=nullif(left(trim(coalesce(p_error_code,'')),160),''),
         lease_owner=case when v_state in ('RESULT_READY','BLOCKED') then lease_owner else null end,
         lease_expires_at=case when v_state in ('RESULT_READY','BLOCKED') then lease_expires_at else null end,
         updated_at=clock_timestamp(),finished_at=case when v_state in ('COMPLETED','FAILED') then clock_timestamp() else null end
   where task_id=p_task_id;
  v_claim_state := case when v_state='AMBIGUOUS' then 'FENCED' when v_state in ('COMPLETED','FAILED') then 'RELEASED' else 'ACTIVE' end;
  if v_claim_state<>'ACTIVE' then
    update destruktion_meta.compute_fabric_browser_fleet_claim_h205f22
       set state=v_claim_state,updated_at=clock_timestamp()
     where task_id=p_task_id and state='ACTIVE' and lease_generation=p_lease_generation;
  end if;
  perform destruktion_meta.compute_fabric_browser_fleet_emit_event_h205f22(
    v_task.workspace_id,'TASK_RESULT_'||v_state,v_task.task_id,v_task.point_id,v_task.role,v_task.lease_agent_id,v_task.lease_generation,v_task.base_sha,
    jsonb_build_object('result_sha256',v_sha,'error_code',nullif(left(trim(coalesce(p_error_code,'')),160),''),'claim_state',v_claim_state),
    v_task.idempotency_key||':result:'||v_task.lease_generation::text||':'||v_state
  );
  return jsonb_build_object('schema','metaengine.browser.fleet-task-result.h205f22.v1','task_id',p_task_id,'state',v_state,'result_sha256',v_sha,
    'claim_state',v_claim_state,'automatic_retry_allowed',false,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_browser_fleet_snapshot_v1(p_workspace_id uuid)
returns jsonb
language sql security definer
set search_path='pg_catalog','destruktion_meta' as $$
select jsonb_build_object(
  'schema','metaengine.browser.fleet-coordination-snapshot.h205f22.v1',
  'workspace_id',p_workspace_id,
  'active_tasks',(select coalesce(jsonb_agg((to_jsonb(t)-'task_spec'-'result_summary') order by t.priority desc,t.created_at,t.task_id),'[]'::jsonb)
    from destruktion_meta.compute_fabric_browser_fleet_task_h205f22 t where t.workspace_id=p_workspace_id and t.state not in ('COMPLETED','FAILED','CANCELLED','FENCED')),
  'active_claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.claim_id),'[]'::jsonb)
    from destruktion_meta.compute_fabric_browser_fleet_claim_h205f22 c where c.workspace_id=p_workspace_id and c.state='ACTIVE'),
  'recent_events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.event_id desc),'[]'::jsonb) from (
    select * from destruktion_meta.compute_fabric_browser_fleet_event_h205f22 where workspace_id=p_workspace_id order by event_id desc limit 100
  ) e),
  'task_specs_exposed',false,
  'page_data_authority',false,
  'canonical',false,
  'authority_effect',false
) $$;

revoke all on function public.h205f22_browser_fleet_enqueue_task_v1(uuid,text,text,text,jsonb,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.h205f22_browser_fleet_lease_task_v1(uuid,text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.h205f22_browser_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_browser_fleet_complete_task_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_browser_fleet_snapshot_v1(uuid) from public,anon,authenticated;

grant execute on function public.h205f22_browser_fleet_enqueue_task_v1(uuid,text,text,text,jsonb,text,text,integer,text) to service_role;
grant execute on function public.h205f22_browser_fleet_lease_task_v1(uuid,text,text,text,text,bigint,integer) to service_role;
grant execute on function public.h205f22_browser_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb) to service_role;
grant execute on function public.h205f22_browser_fleet_complete_task_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text,text) to service_role;
grant execute on function public.h205f22_browser_fleet_snapshot_v1(uuid) to service_role;
