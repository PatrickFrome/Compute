-- METAENGINE H205F22 AOP1 MICROSTEP_LOCKSTEP_V2
-- Non-authority co-development plane. Two models share one immutable semantic
-- subject, produce one observable microstep each per tick, and advance only via
-- an atomic GPT+GLM pair commit whose output is a deterministic checkpoint hash.
-- Normal start path: LOCKSTEP session INSERT -> pg_net after commit -> HMAC-bound
-- Worker wake -> Queue/DO/Workflow. Cron is recovery-only.

create table if not exists destruktion_meta.compute_fabric_duel_session_h205f22 (
  duel_id uuid primary key default gen_random_uuid(),
  duel_key text not null unique,
  roadmap_id text not null default 'compute-fabric-roadmap-v1',
  milestone_key text not null,
  semantic_checkpoint_id text not null,
  semantic_payload_root_sha256 text not null check (semantic_payload_root_sha256 ~ '^[0-9a-f]{64}$'),
  base_github_sha text not null check (base_github_sha ~ '^[0-9a-f]{40}$'),
  subject jsonb not null check (jsonb_typeof(subject)='object'),
  gpt_model text not null default 'openai/gpt-5.6-sol',
  glm_model text not null default '@cf/zai-org/glm-5.2',
  status text not null default 'READY' check (status in ('READY','RUNNING','RESOLVED','CANARY_REQUIRED','BLOCKED','FAILED','CANCELLED')),
  lease_owner text,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  result jsonb,
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);

create table if not exists destruktion_meta.compute_fabric_duel_event_h205f22 (
  event_id bigint generated always as identity primary key,
  duel_id uuid not null references destruktion_meta.compute_fabric_duel_session_h205f22(duel_id),
  phase text not null,
  actor text not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);

alter table destruktion_meta.compute_fabric_duel_session_h205f22 add column if not exists protocol_version text not null default 'PHASE_V1';
alter table destruktion_meta.compute_fabric_duel_session_h205f22 add column if not exists current_tick bigint not null default 0;
alter table destruktion_meta.compute_fabric_duel_session_h205f22 add column if not exists current_checkpoint_sha256 text;
alter table destruktion_meta.compute_fabric_duel_session_h205f22 add column if not exists max_ticks integer not null default 64;
update destruktion_meta.compute_fabric_duel_session_h205f22
set current_checkpoint_sha256=encode(extensions.digest(convert_to(concat_ws('|','DUEL_INIT_V2',duel_id::text,semantic_checkpoint_id,semantic_payload_root_sha256,base_github_sha,subject::text,gpt_model,glm_model),'utf8'),'sha256'),'hex')
where current_checkpoint_sha256 is null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='compute_fabric_duel_session_h205f22_protocol_version_check') then
    alter table destruktion_meta.compute_fabric_duel_session_h205f22 add constraint compute_fabric_duel_session_h205f22_protocol_version_check check(protocol_version in ('PHASE_V1','LOCKSTEP_V2'));
  end if;
  if not exists(select 1 from pg_constraint where conname='compute_fabric_duel_session_h205f22_current_checkpoint_sha256_check') then
    alter table destruktion_meta.compute_fabric_duel_session_h205f22 add constraint compute_fabric_duel_session_h205f22_current_checkpoint_sha256_check check(current_checkpoint_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='compute_fabric_duel_session_h205f22_max_ticks_check') then
    alter table destruktion_meta.compute_fabric_duel_session_h205f22 add constraint compute_fabric_duel_session_h205f22_max_ticks_check check(max_ticks between 1 and 512);
  end if;
end $$;
alter table destruktion_meta.compute_fabric_duel_session_h205f22 alter column current_checkpoint_sha256 set not null;

alter table destruktion_meta.compute_fabric_duel_event_h205f22 add column if not exists tick_no bigint;
alter table destruktion_meta.compute_fabric_duel_event_h205f22 add column if not exists step_type text;
alter table destruktion_meta.compute_fabric_duel_event_h205f22 add column if not exists parent_checkpoint_sha256 text;
alter table destruktion_meta.compute_fabric_duel_event_h205f22 add column if not exists event_sha256 text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='compute_fabric_duel_event_h205f22_event_sha256_check') then
    alter table destruktion_meta.compute_fabric_duel_event_h205f22 add constraint compute_fabric_duel_event_h205f22_event_sha256_check check(event_sha256 is null or event_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='compute_fabric_duel_event_h205f22_parent_checkpoint_sha256_check') then
    alter table destruktion_meta.compute_fabric_duel_event_h205f22 add constraint compute_fabric_duel_event_h205f22_parent_checkpoint_sha256_check check(parent_checkpoint_sha256 is null or parent_checkpoint_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;
create unique index if not exists compute_fabric_duel_event_h205f22_tick_actor_uq
  on destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,tick_no,actor) where tick_no is not null;

create table if not exists destruktion_meta.compute_fabric_duel_tick_h205f22 (
  duel_id uuid not null references destruktion_meta.compute_fabric_duel_session_h205f22(duel_id),
  tick_no bigint not null check(tick_no>0),
  input_checkpoint_sha256 text not null check(input_checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  gpt_event_sha256 text not null check(gpt_event_sha256 ~ '^[0-9a-f]{64}$'),
  glm_event_sha256 text not null check(glm_event_sha256 ~ '^[0-9a-f]{64}$'),
  output_checkpoint_sha256 text not null check(output_checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check(canonical=false),
  authority_effect boolean not null default false check(authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  primary key(duel_id,tick_no)
);

create or replace function destruktion_meta.compute_fabric_duel_event_immutable_h205f22() returns trigger
language plpgsql set search_path=pg_catalog,destruktion_meta as $$ begin raise exception 'duel_event_append_only'; end $$;
drop trigger if exists compute_fabric_duel_event_immutable_h205f22 on destruktion_meta.compute_fabric_duel_event_h205f22;
create trigger compute_fabric_duel_event_immutable_h205f22 before update or delete on destruktion_meta.compute_fabric_duel_event_h205f22 for each row execute function destruktion_meta.compute_fabric_duel_event_immutable_h205f22();
create or replace function destruktion_meta.compute_fabric_duel_tick_immutable_h205f22() returns trigger
language plpgsql set search_path=pg_catalog,destruktion_meta as $$ begin raise exception 'duel_tick_append_only'; end $$;
drop trigger if exists compute_fabric_duel_tick_immutable_h205f22 on destruktion_meta.compute_fabric_duel_tick_h205f22;
create trigger compute_fabric_duel_tick_immutable_h205f22 before update or delete on destruktion_meta.compute_fabric_duel_tick_h205f22 for each row execute function destruktion_meta.compute_fabric_duel_tick_immutable_h205f22();

create table if not exists destruktion_meta.compute_fabric_aop_runtime_endpoint_h205f22 (
  endpoint_key text primary key check(endpoint_key='PRIMARY'),
  runtime_url text not null,
  github_sha text not null check(github_sha ~ '^[0-9a-f]{40}$'),
  github_run_id text not null check(github_run_id ~ '^[0-9]+$'),
  github_run_attempt integer not null check(github_run_attempt>=1),
  workflow_ref text not null,
  registered_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check(canonical=false),
  authority_effect boolean not null default false check(authority_effect=false)
);
create table if not exists destruktion_meta.compute_fabric_aop_runtime_registration_receipt_h205f22 (
  receipt_id bigint generated always as identity primary key,
  oidc_jti_sha256 text not null unique check(oidc_jti_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_url text not null,
  github_sha text not null check(github_sha ~ '^[0-9a-f]{40}$'),
  github_run_id text not null,
  github_run_attempt integer not null,
  workflow_ref text not null,
  registered_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check(canonical=false),
  authority_effect boolean not null default false check(authority_effect=false)
);
create or replace function destruktion_meta.compute_fabric_aop_runtime_registration_immutable_h205f22() returns trigger
language plpgsql set search_path=pg_catalog,destruktion_meta as $$ begin raise exception 'aop_runtime_registration_append_only'; end $$;
drop trigger if exists compute_fabric_aop_runtime_registration_immutable_h205f22 on destruktion_meta.compute_fabric_aop_runtime_registration_receipt_h205f22;
create trigger compute_fabric_aop_runtime_registration_immutable_h205f22 before update or delete on destruktion_meta.compute_fabric_aop_runtime_registration_receipt_h205f22 for each row execute function destruktion_meta.compute_fabric_aop_runtime_registration_immutable_h205f22();

revoke all on destruktion_meta.compute_fabric_duel_session_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_duel_event_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_duel_tick_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_aop_runtime_endpoint_h205f22 from public,anon,authenticated,service_role;
revoke all on destruktion_meta.compute_fabric_aop_runtime_registration_receipt_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_duel_create_lockstep_v2(
  p_duel_key text,p_milestone_key text,p_base_github_sha text,p_subject jsonb,
  p_gpt_model text default 'openai/gpt-5.6-sol',p_glm_model text default '@cf/zai-org/glm-5.2',p_max_ticks integer default 64
) returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare h record; d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; init_sha text; body jsonb;
begin
  if p_duel_key is null or length(trim(p_duel_key))<3 then raise exception 'duel_key_required'; end if;
  if p_base_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'invalid_base_github_sha'; end if;
  if jsonb_typeof(coalesce(p_subject,'{}'::jsonb))<>'object' then raise exception 'subject_must_be_object'; end if;
  if p_max_ticks<1 or p_max_ticks>512 then raise exception 'max_ticks_out_of_range'; end if;
  if not exists(select 1 from destruktion_meta.compute_fabric_roadmap_milestone_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=p_milestone_key) then raise exception 'unknown_milestone'; end if;
  select checkpoint_id,payload_root_sha256 into h from destruktion_meta.chat_capsule_checkpoint order by created_at desc limit 1;
  if h.checkpoint_id is null then raise exception 'semantic_head_missing'; end if;
  init_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_LOCKSTEP_V2',p_duel_key,h.checkpoint_id,h.payload_root_sha256,p_base_github_sha,p_subject::text,p_gpt_model,p_glm_model,p_max_ticks::text),'utf8'),'sha256'),'hex');
  insert into destruktion_meta.compute_fabric_duel_session_h205f22(duel_key,milestone_key,semantic_checkpoint_id,semantic_payload_root_sha256,base_github_sha,subject,gpt_model,glm_model,protocol_version,current_tick,current_checkpoint_sha256,max_ticks)
  values(p_duel_key,p_milestone_key,h.checkpoint_id,h.payload_root_sha256,p_base_github_sha,p_subject,p_gpt_model,p_glm_model,'LOCKSTEP_V2',0,init_sha,p_max_ticks)
  on conflict(duel_key) do nothing;
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_key=p_duel_key;
  if d.protocol_version<>'LOCKSTEP_V2' or d.milestone_key<>p_milestone_key or d.semantic_checkpoint_id<>h.checkpoint_id or d.semantic_payload_root_sha256<>h.payload_root_sha256 or d.base_github_sha<>p_base_github_sha or d.subject<>p_subject or d.gpt_model<>p_gpt_model or d.glm_model<>p_glm_model or d.max_ticks<>p_max_ticks then raise exception 'duel_key_subject_mismatch'; end if;
  body:=jsonb_build_object('schema','metaengine.compute.duel-lockstep.h205f22.v2','duel_id',d.duel_id,'duel_key',d.duel_key,'milestone_key',d.milestone_key,'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,'base_github_sha',d.base_github_sha,'protocol_version',d.protocol_version,'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,'max_ticks',d.max_ticks,'gpt_model',d.gpt_model,'glm_model',d.glm_model,'status',d.status,'canonical',false,'authority_effect',false);
  if not exists(select 1 from destruktion_meta.compute_fabric_duel_event_h205f22 where duel_id=d.duel_id and phase='CREATED_V2') then
    insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256) values(d.duel_id,'CREATED_V2','SYSTEM',body,encode(extensions.digest(convert_to(body::text,'utf8'),'sha256'),'hex'));
  end if;
  return body;
end $$;

create or replace function public.h205f22_duel_lease_lockstep_v2(p_worker text,p_lease_seconds integer default 1200)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
begin
  if p_worker is null or length(trim(p_worker))<3 then raise exception 'worker_required'; end if;
  if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'lease_seconds_out_of_range'; end if;
  update destruktion_meta.compute_fabric_duel_session_h205f22 set status='READY',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where protocol_version='LOCKSTEP_V2' and status='RUNNING' and lease_expires_at<=clock_timestamp();
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where protocol_version='LOCKSTEP_V2' and status='READY' order by created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('schema','metaengine.compute.duel-lockstep-lease.h205f22.v2','leased',false); end if;
  update destruktion_meta.compute_fabric_duel_session_h205f22 set status='RUNNING',lease_owner=p_worker,lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp() where duel_id=d.duel_id returning * into d;
  return jsonb_build_object('schema','metaengine.compute.duel-lockstep-lease.h205f22.v2','leased',true,'duel_id',d.duel_id,'duel_key',d.duel_key,'milestone_key',d.milestone_key,'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,'base_github_sha',d.base_github_sha,'subject',d.subject,'gpt_model',d.gpt_model,'glm_model',d.glm_model,'protocol_version',d.protocol_version,'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,'max_ticks',d.max_ticks,'lease_generation',d.lease_generation,'lease_expires_at',d.lease_expires_at,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_duel_submit_pair_v2(
  p_duel_id uuid,p_worker text,p_lease_generation bigint,p_tick_no bigint,p_seen_checkpoint_sha256 text,
  p_gpt_step_type text,p_gpt_payload jsonb,p_glm_step_type text,p_glm_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; g_payload_sha text; l_payload_sha text; g_event_sha text; l_event_sha text; out_sha text; g_event_id bigint; l_event_id bigint;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id for update;
  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'RUNNING' or d.lease_owner<>p_worker or d.lease_generation<>p_lease_generation or d.lease_expires_at<=clock_timestamp() then raise exception 'duel_lockstep_lease_fenced'; end if;
  if p_tick_no<>d.current_tick+1 then raise exception 'duel_tick_mismatch expected % got %',d.current_tick+1,p_tick_no; end if;
  if d.current_tick>=d.max_ticks then raise exception 'duel_max_ticks_reached'; end if;
  if p_seen_checkpoint_sha256 is distinct from d.current_checkpoint_sha256 then raise exception 'duel_checkpoint_stale'; end if;
  if jsonb_typeof(coalesce(p_gpt_payload,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_glm_payload,'{}'::jsonb))<>'object' then raise exception 'microstep_payload_must_be_object'; end if;
  if p_gpt_step_type is null or length(trim(p_gpt_step_type))<2 or p_glm_step_type is null or length(trim(p_glm_step_type))<2 then raise exception 'microstep_type_required'; end if;
  g_payload_sha:=encode(extensions.digest(convert_to(p_gpt_payload::text,'utf8'),'sha256'),'hex');
  l_payload_sha:=encode(extensions.digest(convert_to(p_glm_payload::text,'utf8'),'sha256'),'hex');
  g_event_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_EVENT_V2',p_duel_id::text,p_tick_no::text,'GPT',d.current_checkpoint_sha256,p_gpt_step_type,g_payload_sha),'utf8'),'sha256'),'hex');
  l_event_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_EVENT_V2',p_duel_id::text,p_tick_no::text,'GLM',d.current_checkpoint_sha256,p_glm_step_type,l_payload_sha),'utf8'),'sha256'),'hex');
  out_sha:=encode(extensions.digest(convert_to(concat_ws('|','DUEL_TICK_V2',p_duel_id::text,p_tick_no::text,d.current_checkpoint_sha256,g_event_sha,l_event_sha),'utf8'),'sha256'),'hex');
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256,tick_no,step_type,parent_checkpoint_sha256,event_sha256) values(p_duel_id,'MICROSTEP','GPT',p_gpt_payload,g_payload_sha,p_tick_no,p_gpt_step_type,d.current_checkpoint_sha256,g_event_sha) returning event_id into g_event_id;
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256,tick_no,step_type,parent_checkpoint_sha256,event_sha256) values(p_duel_id,'MICROSTEP','GLM',p_glm_payload,l_payload_sha,p_tick_no,p_glm_step_type,d.current_checkpoint_sha256,l_event_sha) returning event_id into l_event_id;
  insert into destruktion_meta.compute_fabric_duel_tick_h205f22(duel_id,tick_no,input_checkpoint_sha256,gpt_event_sha256,glm_event_sha256,output_checkpoint_sha256) values(p_duel_id,p_tick_no,d.current_checkpoint_sha256,g_event_sha,l_event_sha,out_sha);
  update destruktion_meta.compute_fabric_duel_session_h205f22 set current_tick=p_tick_no,current_checkpoint_sha256=out_sha,updated_at=clock_timestamp() where duel_id=p_duel_id;
  return jsonb_build_object('schema','metaengine.compute.duel-microstep-pair.h205f22.v2','duel_id',p_duel_id,'tick_no',p_tick_no,'input_checkpoint_sha256',d.current_checkpoint_sha256,'gpt_event_id',g_event_id,'gpt_payload_sha256',g_payload_sha,'gpt_event_sha256',g_event_sha,'glm_event_id',l_event_id,'glm_payload_sha256',l_payload_sha,'glm_event_sha256',l_event_sha,'output_checkpoint_sha256',out_sha,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_duel_read_lockstep_v2(p_duel_id uuid,p_after_tick bigint default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; ev jsonb; tk jsonb;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found then raise exception 'duel_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_id',e.event_id,'tick_no',e.tick_no,'actor',e.actor,'step_type',e.step_type,'payload',e.payload,'payload_sha256',e.payload_sha256,'parent_checkpoint_sha256',e.parent_checkpoint_sha256,'event_sha256',e.event_sha256,'created_at',e.created_at) order by e.tick_no,e.actor),'[]'::jsonb) into ev from destruktion_meta.compute_fabric_duel_event_h205f22 e where e.duel_id=p_duel_id and e.tick_no>p_after_tick;
  select coalesce(jsonb_agg(jsonb_build_object('tick_no',t.tick_no,'input_checkpoint_sha256',t.input_checkpoint_sha256,'gpt_event_sha256',t.gpt_event_sha256,'glm_event_sha256',t.glm_event_sha256,'output_checkpoint_sha256',t.output_checkpoint_sha256,'created_at',t.created_at) order by t.tick_no),'[]'::jsonb) into tk from destruktion_meta.compute_fabric_duel_tick_h205f22 t where t.duel_id=p_duel_id and t.tick_no>p_after_tick;
  return jsonb_build_object('schema','metaengine.compute.duel-lockstep-readback.h205f22.v2','duel_id',d.duel_id,'duel_key',d.duel_key,'status',d.status,'protocol_version',d.protocol_version,'checkpoint_id',d.semantic_checkpoint_id,'payload_root_sha256',d.semantic_payload_root_sha256,'base_github_sha',d.base_github_sha,'current_tick',d.current_tick,'current_checkpoint_sha256',d.current_checkpoint_sha256,'max_ticks',d.max_ticks,'events',ev,'ticks',tk,'result',d.result,'result_sha256',d.result_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_duel_complete_lockstep_v2(p_duel_id uuid,p_worker text,p_lease_generation bigint,p_status text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; sha text; evt jsonb;
begin
  if p_status not in('RESOLVED','CANARY_REQUIRED','BLOCKED','FAILED') then raise exception 'invalid_duel_terminal_status'; end if;
  if jsonb_typeof(coalesce(p_result,'{}'::jsonb))<>'object' then raise exception 'result_must_be_object'; end if;
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id for update;
  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'RUNNING' or d.lease_owner<>p_worker or d.lease_generation<>p_lease_generation or d.lease_expires_at<=clock_timestamp() then raise exception 'duel_lockstep_lease_fenced'; end if;
  if coalesce(p_result->>'final_checkpoint_sha256','')<>d.current_checkpoint_sha256 then raise exception 'duel_terminal_checkpoint_mismatch'; end if;
  sha:=encode(extensions.digest(convert_to(p_result::text,'utf8'),'sha256'),'hex');
  update destruktion_meta.compute_fabric_duel_session_h205f22 set status=p_status,result=p_result,result_sha256=sha,lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp(),finished_at=clock_timestamp() where duel_id=p_duel_id returning * into d;
  evt:=jsonb_build_object('status',p_status,'final_tick',d.current_tick,'final_checkpoint_sha256',d.current_checkpoint_sha256,'result_sha256',sha,'canonical',false,'authority_effect',false);
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256) values(p_duel_id,'COMPLETED_V2','SYSTEM',evt,encode(extensions.digest(convert_to(evt::text,'utf8'),'sha256'),'hex'));
  return jsonb_build_object('completed',true,'duel_id',d.duel_id,'duel_key',d.duel_key,'status',d.status,'final_tick',d.current_tick,'final_checkpoint_sha256',d.current_checkpoint_sha256,'result_sha256',d.result_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_duel_snapshot_v1() returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta as $$
  select jsonb_build_object(
    'schema','metaengine.compute.duel-snapshot.h205f22.v1',
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('duel_id',duel_id,'duel_key',duel_key,'milestone_key',milestone_key,'protocol_version',protocol_version,'status',status,'current_tick',current_tick,'current_checkpoint_sha256',current_checkpoint_sha256,'base_github_sha',base_github_sha,'gpt_model',gpt_model,'glm_model',glm_model,'created_at',created_at,'updated_at',updated_at) order by created_at desc) from (select * from destruktion_meta.compute_fabric_duel_session_h205f22 order by created_at desc limit 20) s),'[]'::jsonb),
    'canonical',false,'authority_effect',false
  )
$$;

create or replace function destruktion_meta.compute_fabric_duel_enqueue_wake_h205f22(p_duel_id uuid)
returns bigint language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions,vault,net as $$
declare d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; u text; k text; body jsonb; wake_id text; msg text; sig text; req bigint; evt jsonb;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'READY' then return null; end if;
  select runtime_url into u from destruktion_meta.compute_fabric_aop_runtime_endpoint_h205f22 where endpoint_key='PRIMARY';
  if u is null then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='aop1_wake_secret' order by created_at desc limit 1;
  if k is null or length(k)<16 then raise exception 'duel_wake_secret_unavailable'; end if;
  wake_id:='duel:'||d.duel_id::text||':'||d.current_checkpoint_sha256;
  body:=jsonb_build_object('id',wake_id,'reason','DUEL_DB_INSERT','source','supabase-pg-net','payload',jsonb_build_object('duel_id',d.duel_id,'duel_key',d.duel_key,'checkpoint_sha256',d.current_checkpoint_sha256));
  msg:=concat_ws('|',wake_id,'DUEL_DB_INSERT',d.duel_id::text,d.current_checkpoint_sha256);
  sig:=encode(extensions.hmac(convert_to(msg,'utf8'),convert_to(k,'utf8'),'sha256'),'hex');
  select net.http_post(url:=u||'/duel/db-wake',body:=body,headers:=jsonb_build_object('Content-Type','application/json','X-Metaengine-Duel-Signature-256','sha256='||sig),timeout_milliseconds:=5000) into req;
  evt:=jsonb_build_object('request_id',req,'runtime_url_sha256',encode(extensions.digest(convert_to(u,'utf8'),'sha256'),'hex'),'wake_id',wake_id,'message_sha256',encode(extensions.digest(convert_to(msg,'utf8'),'sha256'),'hex'),'canonical',false,'authority_effect',false);
  insert into destruktion_meta.compute_fabric_duel_event_h205f22(duel_id,phase,actor,payload,payload_sha256) values(d.duel_id,'WAKE_ENQUEUED','SYSTEM',evt,encode(extensions.digest(convert_to(evt::text,'utf8'),'sha256'),'hex'));
  return req;
end $$;

create or replace function destruktion_meta.compute_fabric_duel_wake_after_insert_h205f22() returns trigger
language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$ begin perform destruktion_meta.compute_fabric_duel_enqueue_wake_h205f22(new.duel_id); return new; end $$;
drop trigger if exists compute_fabric_duel_wake_after_insert_h205f22 on destruktion_meta.compute_fabric_duel_session_h205f22;
create trigger compute_fabric_duel_wake_after_insert_h205f22 after insert on destruktion_meta.compute_fabric_duel_session_h205f22 for each row execute function destruktion_meta.compute_fabric_duel_wake_after_insert_h205f22();

create or replace function public.h205f22_aop1_register_runtime_endpoint_v1(
  p_oidc_jti text,p_runtime_url text,p_github_sha text,p_github_run_id text,p_github_run_attempt integer,p_workflow_ref text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare jsha text; rec_id bigint; d record; queued integer:=0;
begin
  if p_oidc_jti is null or length(p_oidc_jti)<8 or length(p_oidc_jti)>512 then raise exception 'runtime_registration_jti_invalid'; end if;
  if p_runtime_url !~ '^https://metaengine-h205f22-aop1\.[a-z0-9-]+\.workers\.dev/?$' then raise exception 'runtime_url_forbidden'; end if;
  if p_github_sha !~ '^[0-9a-f]{40}$' then raise exception 'runtime_registration_sha_invalid'; end if;
  if p_github_run_id !~ '^[0-9]+$' or p_github_run_attempt<1 then raise exception 'runtime_registration_run_invalid'; end if;
  if p_workflow_ref<>'PatrickFrome/Compute/.github/workflows/aop1-live-deploy.yml@refs/heads/work/aop1-autonomous-orchestration' then raise exception 'runtime_registration_workflow_forbidden'; end if;
  jsha:=encode(extensions.digest(convert_to(p_oidc_jti,'utf8'),'sha256'),'hex');
  begin
    insert into destruktion_meta.compute_fabric_aop_runtime_registration_receipt_h205f22(oidc_jti_sha256,runtime_url,github_sha,github_run_id,github_run_attempt,workflow_ref)
    values(jsha,rtrim(p_runtime_url,'/'),p_github_sha,p_github_run_id,p_github_run_attempt,p_workflow_ref) returning receipt_id into rec_id;
  exception when unique_violation then raise exception 'runtime_registration_oidc_replay_denied'; end;
  insert into destruktion_meta.compute_fabric_aop_runtime_endpoint_h205f22(endpoint_key,runtime_url,github_sha,github_run_id,github_run_attempt,workflow_ref,registered_at)
  values('PRIMARY',rtrim(p_runtime_url,'/'),p_github_sha,p_github_run_id,p_github_run_attempt,p_workflow_ref,clock_timestamp())
  on conflict(endpoint_key) do update set runtime_url=excluded.runtime_url,github_sha=excluded.github_sha,github_run_id=excluded.github_run_id,github_run_attempt=excluded.github_run_attempt,workflow_ref=excluded.workflow_ref,registered_at=excluded.registered_at;
  for d in select duel_id from destruktion_meta.compute_fabric_duel_session_h205f22 where protocol_version='LOCKSTEP_V2' and status='READY' order by created_at loop
    if destruktion_meta.compute_fabric_duel_enqueue_wake_h205f22(d.duel_id) is not null then queued:=queued+1; end if;
  end loop;
  return jsonb_build_object('schema','metaengine.compute.aop-runtime-endpoint.h205f22.v1','registered',true,'receipt_id',rec_id,'runtime_url',rtrim(p_runtime_url,'/'),'github_sha',p_github_sha,'github_run_id',p_github_run_id,'github_run_attempt',p_github_run_attempt,'ready_duels_wake_queued',queued,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_duel_create_lockstep_v2(text,text,text,jsonb,text,text,integer) from public,anon,authenticated;
revoke all on function public.h205f22_duel_lease_lockstep_v2(text,integer) from public,anon,authenticated;
revoke all on function public.h205f22_duel_submit_pair_v2(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_duel_read_lockstep_v2(uuid,bigint) from public,anon,authenticated;
revoke all on function public.h205f22_duel_complete_lockstep_v2(uuid,text,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_duel_snapshot_v1() from public,anon,authenticated;
revoke all on function public.h205f22_aop1_register_runtime_endpoint_v1(text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.h205f22_duel_create_lockstep_v2(text,text,text,jsonb,text,text,integer) to service_role;
grant execute on function public.h205f22_duel_lease_lockstep_v2(text,integer) to service_role;
grant execute on function public.h205f22_duel_submit_pair_v2(uuid,text,bigint,bigint,text,text,jsonb,text,jsonb) to service_role;
grant execute on function public.h205f22_duel_read_lockstep_v2(uuid,bigint) to service_role;
grant execute on function public.h205f22_duel_complete_lockstep_v2(uuid,text,bigint,text,jsonb) to service_role;
grant execute on function public.h205f22_duel_snapshot_v1() to service_role;
grant execute on function public.h205f22_aop1_register_runtime_endpoint_v1(text,text,text,text,integer,text) to service_role;
