-- METAENGINE H205F22 AOP1 clean replay migration
-- Baseline-relative: requires the existing H205F22 roadmap/supervisor/claim plane.
-- Creates orchestration state only. It does not grant checkpoint/mainline authority.

create table if not exists destruktion_meta.compute_fabric_aop_role_h205f22 (
  role_key text primary key,
  role_kind text not null check (role_kind in ('IMPLEMENTER','ANALYST','SUPERVISOR')),
  milestone_key text null,
  mutation_domains text[] not null default '{}'::text[],
  executor_profile text not null default 'DEFAULT',
  enabled boolean not null default true,
  max_attempts integer not null default 6 check (max_attempts between 1 and 50),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  orchestration_effect boolean not null default true,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((role_kind='IMPLEMENTER' and milestone_key is not null) or (role_kind<>'IMPLEMENTER' and milestone_key is null))
);
create unique index if not exists compute_fabric_aop_role_milestone_uq
  on destruktion_meta.compute_fabric_aop_role_h205f22(milestone_key) where milestone_key is not null;

create table if not exists destruktion_meta.compute_fabric_aop_event_h205f22 (
  event_id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  event_type text not null check (char_length(event_type) between 3 and 96),
  roadmap_id text not null default 'compute-fabric-roadmap-v1',
  milestone_key text null,
  run_id uuid null,
  source_role_key text null,
  source_kind text not null default 'SYSTEM',
  semantic_checkpoint_id text null,
  semantic_payload_root_sha256 text null,
  github_sha text null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists compute_fabric_aop_event_route_idx
  on destruktion_meta.compute_fabric_aop_event_h205f22(roadmap_id,milestone_key,event_id desc);

create table if not exists destruktion_meta.compute_fabric_aop_run_h205f22 (
  run_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  roadmap_id text not null default 'compute-fabric-roadmap-v1',
  milestone_key text null,
  role_key text not null references destruktion_meta.compute_fabric_aop_role_h205f22(role_key),
  trigger_event_id bigint null references destruktion_meta.compute_fabric_aop_event_h205f22(event_id),
  parent_run_id uuid null references destruktion_meta.compute_fabric_aop_run_h205f22(run_id),
  claim_id bigint null,
  directive_id bigint null,
  base_checkpoint_id text null,
  base_payload_root_sha256 text null,
  expected_github_sha text null,
  state text not null default 'READY' check (state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT','COMPLETED','FAILED','CANCELLED','FENCED')),
  lease_owner text null,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 6 check (max_attempts between 1 and 50),
  wake_condition text null,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input)='object'),
  output jsonb null,
  output_sha256 text null,
  result_code text null,
  error_class text null,
  error_code text null,
  error_text text null,
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  started_at timestamptz null,
  finished_at timestamptz null,
  check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists compute_fabric_aop_run_ready_idx on destruktion_meta.compute_fabric_aop_run_h205f22(state,role_key,created_at);
create index if not exists compute_fabric_aop_run_milestone_idx on destruktion_meta.compute_fabric_aop_run_h205f22(roadmap_id,milestone_key,created_at desc);
create index if not exists compute_fabric_aop_run_parent_idx on destruktion_meta.compute_fabric_aop_run_h205f22(parent_run_id) where parent_run_id is not null;
create index if not exists compute_fabric_aop_run_role_idx on destruktion_meta.compute_fabric_aop_run_h205f22(role_key);
create index if not exists compute_fabric_aop_run_trigger_event_idx on destruktion_meta.compute_fabric_aop_run_h205f22(trigger_event_id) where trigger_event_id is not null;

alter table destruktion_meta.compute_fabric_aop_role_h205f22 enable row level security;
alter table destruktion_meta.compute_fabric_aop_event_h205f22 enable row level security;
alter table destruktion_meta.compute_fabric_aop_run_h205f22 enable row level security;
do $$ begin create policy compute_fabric_aop_role_deny_clients on destruktion_meta.compute_fabric_aop_role_h205f22 for all to anon,authenticated using(false) with check(false); exception when duplicate_object then null; end $$;
do $$ begin create policy compute_fabric_aop_event_deny_clients on destruktion_meta.compute_fabric_aop_event_h205f22 for all to anon,authenticated using(false) with check(false); exception when duplicate_object then null; end $$;
do $$ begin create policy compute_fabric_aop_run_deny_clients on destruktion_meta.compute_fabric_aop_run_h205f22 for all to anon,authenticated using(false) with check(false); exception when duplicate_object then null; end $$;
revoke all on destruktion_meta.compute_fabric_aop_role_h205f22 from public,anon,authenticated;
revoke all on destruktion_meta.compute_fabric_aop_event_h205f22 from public,anon,authenticated;
revoke all on destruktion_meta.compute_fabric_aop_run_h205f22 from public,anon,authenticated;

create or replace function destruktion_meta.compute_fabric_aop_event_immutable_h205f22()
returns trigger language plpgsql set search_path='pg_catalog' as $$ begin raise exception 'aop_event_is_append_only' using errcode='55000'; end $$;
drop trigger if exists compute_fabric_aop_event_immutable_trg on destruktion_meta.compute_fabric_aop_event_h205f22;
create trigger compute_fabric_aop_event_immutable_trg before update or delete on destruktion_meta.compute_fabric_aop_event_h205f22 for each row execute function destruktion_meta.compute_fabric_aop_event_immutable_h205f22();

create or replace function destruktion_meta.compute_fabric_aop_terminal_run_guard_h205f22()
returns trigger language plpgsql set search_path='pg_catalog' as $$
begin
  if old.state in ('COMPLETED','FAILED','CANCELLED','FENCED') then raise exception 'aop_terminal_run_is_immutable' using errcode='55000'; end if;
  return new;
end $$;
drop trigger if exists compute_fabric_aop_terminal_run_guard_trg on destruktion_meta.compute_fabric_aop_run_h205f22;
create trigger compute_fabric_aop_terminal_run_guard_trg before update on destruktion_meta.compute_fabric_aop_run_h205f22 for each row execute function destruktion_meta.compute_fabric_aop_terminal_run_guard_h205f22();

create or replace function destruktion_meta.compute_fabric_aop_emit_event_h205f22(
  p_event_type text,p_milestone_key text default null,p_run_id uuid default null,p_source_role_key text default null,p_source_kind text default 'SYSTEM',p_payload jsonb default '{}'::jsonb,p_idempotency_key text default null,p_github_sha text default null
) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare v_head jsonb; v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_payload_sha text; v_idem text; v_id bigint; v_inserted boolean:=false;
begin
  if p_event_type is null or char_length(p_event_type)<3 then raise exception 'invalid_event_type' using errcode='22023'; end if;
  if jsonb_typeof(v_payload)<>'object' then raise exception 'event_payload_must_be_object' using errcode='22023'; end if;
  v_head:=destruktion_meta.compute_fabric_roadmap_status_h205f22()->'semantic_head';
  v_payload_sha:=encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  v_idem:=coalesce(nullif(p_idempotency_key,''),encode(extensions.digest(convert_to(jsonb_build_object('event_type',p_event_type,'milestone_key',p_milestone_key,'run_id',p_run_id,'source_role_key',p_source_role_key,'payload_sha256',v_payload_sha,'github_sha',p_github_sha)::text,'UTF8'),'sha256'),'hex'));
  insert into destruktion_meta.compute_fabric_aop_event_h205f22(idempotency_key,event_type,milestone_key,run_id,source_role_key,source_kind,semantic_checkpoint_id,semantic_payload_root_sha256,github_sha,payload,payload_sha256)
  values(v_idem,p_event_type,p_milestone_key,p_run_id,p_source_role_key,coalesce(nullif(p_source_kind,''),'SYSTEM'),v_head->>'checkpoint_id',v_head->>'payload_root_sha256',p_github_sha,v_payload,v_payload_sha)
  on conflict(idempotency_key) do nothing returning event_id into v_id;
  if v_id is not null then v_inserted:=true; else select event_id into v_id from destruktion_meta.compute_fabric_aop_event_h205f22 where idempotency_key=v_idem; end if;
  return jsonb_build_object('schema','metaengine.compute.aop-event.h205f22.v3','event_id',v_id,'idempotency_key',v_idem,'event_type',p_event_type,'payload_sha256',v_payload_sha,'duplicate',not v_inserted,'canonical',false,'authority_effect',false);
end $$;

create or replace function destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(
  p_role_key text,p_milestone_key text default null,p_trigger_event_id bigint default null,p_parent_run_id uuid default null,p_input jsonb default '{}'::jsonb,p_idempotency_key text default null,p_expected_github_sha text default null,p_initial_state text default 'READY',p_wake_condition text default null
) returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_head jsonb; v_claim_id bigint; v_directive_id bigint; v_run_id uuid; v_idem text; v_milestone text; v_state text:=coalesce(p_initial_state,'READY'); v_inserted boolean:=false;
begin
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=p_role_key and enabled=true;
  if not found then raise exception 'unknown_or_disabled_role:%',p_role_key using errcode='22023'; end if;
  v_milestone:=coalesce(p_milestone_key,v_role.milestone_key);
  if v_role.role_kind='IMPLEMENTER' and v_milestone is distinct from v_role.milestone_key then raise exception 'implementer_milestone_mismatch' using errcode='22023'; end if;
  if v_state not in ('READY','WAITING_EXECUTOR','WAITING_EVENT') then raise exception 'invalid_initial_state' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_input,'{}'::jsonb))<>'object' then raise exception 'run_input_must_be_object' using errcode='22023'; end if;
  v_head:=destruktion_meta.compute_fabric_roadmap_status_h205f22()->'semantic_head';
  if v_milestone is not null then
    select claim_id into v_claim_id from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=v_milestone and state='ACTIVE' order by claim_id desc limit 1;
    select directive_id into v_directive_id from destruktion_meta.compute_fabric_supervisor_directive_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=v_milestone and status='ACTIVE' and (expires_at is null or expires_at>clock_timestamp()) order by directive_id desc limit 1;
  end if;
  v_idem:=coalesce(nullif(p_idempotency_key,''),encode(extensions.digest(convert_to(jsonb_build_object('role_key',p_role_key,'milestone_key',v_milestone,'trigger_event_id',p_trigger_event_id,'parent_run_id',p_parent_run_id,'input',coalesce(p_input,'{}'::jsonb),'base_checkpoint_id',v_head->>'checkpoint_id')::text,'UTF8'),'sha256'),'hex'));
  insert into destruktion_meta.compute_fabric_aop_run_h205f22(idempotency_key,milestone_key,role_key,trigger_event_id,parent_run_id,claim_id,directive_id,base_checkpoint_id,base_payload_root_sha256,expected_github_sha,state,max_attempts,wake_condition,input)
  values(v_idem,v_milestone,p_role_key,p_trigger_event_id,p_parent_run_id,v_claim_id,v_directive_id,v_head->>'checkpoint_id',v_head->>'payload_root_sha256',p_expected_github_sha,v_state,v_role.max_attempts,p_wake_condition,coalesce(p_input,'{}'::jsonb))
  on conflict(idempotency_key) do nothing returning run_id into v_run_id;
  if v_run_id is not null then v_inserted:=true; else select run_id into v_run_id from destruktion_meta.compute_fabric_aop_run_h205f22 where idempotency_key=v_idem; end if;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_ENQUEUED',v_milestone,v_run_id,p_role_key,'AOP',jsonb_build_object('role_kind',v_role.role_kind,'state',v_state,'claim_id',v_claim_id,'directive_id',v_directive_id),v_idem||':event',p_expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-enqueue.h205f22.v2','run_id',v_run_id,'role_key',p_role_key,'milestone_key',v_milestone,'state',v_state,'claim_id',v_claim_id,'directive_id',v_directive_id,'base_checkpoint_id',v_head->>'checkpoint_id','duplicate',not v_inserted,'canonical',false,'authority_effect',false);
end $$;

create or replace function destruktion_meta.compute_fabric_aop_reconcile_h205f22()
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare v_status jsonb; v_m jsonb; v_role text; v_holder text; v_claim_id bigint; v_created integer:=0; v_result jsonb; v_milestone text; v_effective text;
begin
  if not pg_try_advisory_xact_lock(hashtext('metaengine:h205f22:aop1:reconcile')) then return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v2','status','SKIPPED_LOCKED','created_runs',0,'canonical',false,'authority_effect',false); end if;
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  for v_m in select value from jsonb_array_elements(v_status->'milestones') loop
    v_milestone:=v_m->>'milestone_key'; v_effective:=v_m->>'effective_status';
    if v_effective='EVIDENCE_READY' then
      if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key in ('INTEGRATION_ANALYST','MAINLINE_SUPERVISOR') and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and created_at>clock_timestamp()-interval '24 hours') then
        v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_EVIDENCE_READY','roadmap_status',v_effective),'reconcile:analyst:'||v_milestone||':'||coalesce(v_status#>>'{semantic_head,checkpoint_id}','none')); v_created:=v_created+1;
      end if;
    elsif v_effective='IN_PROGRESS' then
      select role_key into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_milestone and enabled=true;
      if v_role is not null then
        v_holder:='aop1:'||v_role;
        select claim_id into v_claim_id from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=v_milestone and state='ACTIVE' and expires_at>clock_timestamp() and holder_id=v_holder order by claim_id desc limit 1;
        if v_claim_id is not null then
          if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key=v_role and claim_id=v_claim_id and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and created_at>clock_timestamp()-interval '24 hours') then
            v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_role,v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_IN_PROGRESS','roadmap_status',v_effective,'authority_holder',v_holder),'reconcile:implementer:'||v_milestone||':'||v_claim_id::text||':'||coalesce(v_status#>>'{semantic_head,checkpoint_id}','none')); v_created:=v_created+1;
          end if;
        elsif not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='MAINLINE_SUPERVISOR' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and input->>'reason'='AUTHORITY_REBIND_REQUIRED') then
          v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_milestone,null,null,jsonb_build_object('reason','AUTHORITY_REBIND_REQUIRED','target_holder',v_holder,'roadmap_status',v_effective),'reconcile:authority-rebind:'||v_milestone||':'||coalesce(v_status#>>'{semantic_head,checkpoint_id}','none')); v_created:=v_created+1;
        end if;
      end if;
    end if;
    v_role:=null; v_holder:=null; v_claim_id:=null;
  end loop;
  return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v2','status','PASS','created_runs',v_created,'semantic_head',v_status->'semantic_head','canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_lease_run_v1(p_worker text,p_role_key text default null,p_lease_seconds integer default 180)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_status jsonb; v_snapshot jsonb; v_claim jsonb; v_directive jsonb;
begin
  if p_worker is null or char_length(p_worker)<3 then raise exception 'invalid_worker' using errcode='22023'; end if; if p_lease_seconds<30 or p_lease_seconds>900 then raise exception 'invalid_lease_seconds' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  with picked as (
    select r.run_id from destruktion_meta.compute_fabric_aop_run_h205f22 r join destruktion_meta.compute_fabric_aop_role_h205f22 ro on ro.role_key=r.role_key and ro.enabled
    where (r.state='READY' or (r.state='LEASED' and r.lease_expires_at<clock_timestamp())) and r.attempt_count<r.max_attempts and (p_role_key is null or r.role_key=p_role_key)
      and (ro.role_kind<>'IMPLEMENTER' or exists(select 1 from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c where c.claim_id=r.claim_id and c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.holder_id='aop1:'||r.role_key))
    order by case r.role_key when 'MAINLINE_SUPERVISOR' then 0 when 'INTEGRATION_ANALYST' then 1 else 2 end,r.created_at,r.run_id for update of r skip locked limit 1
  ) update destruktion_meta.compute_fabric_aop_run_h205f22 r set state='LEASED',lease_owner=p_worker,lease_generation=r.lease_generation+1,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=r.attempt_count+1,started_at=coalesce(r.started_at,clock_timestamp()),updated_at=clock_timestamp() from picked p where r.run_id=p.run_id returning r.* into v_run;
  if not found then return jsonb_build_object('schema','metaengine.compute.aop-lease.h205f22.v2','leased',false,'canonical',false,'authority_effect',false); end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key; v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22(); v_snapshot:=destruktion_meta.compute_fabric_supervisor_snapshot_h205f22();
  if v_run.claim_id is not null then select to_jsonb(c)-'claim_token' into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c where claim_id=v_run.claim_id; end if;
  if v_run.directive_id is not null then select to_jsonb(d) into v_directive from destruktion_meta.compute_fabric_supervisor_directive_h205f22 d where directive_id=v_run.directive_id; end if;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_LEASED',v_run.milestone_key,v_run.run_id,v_run.role_key,'AOP',jsonb_build_object('worker',p_worker,'lease_generation',v_run.lease_generation,'attempt_count',v_run.attempt_count),v_run.idempotency_key||':lease:'||v_run.lease_generation::text,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-lease.h205f22.v2','leased',true,'run_id',v_run.run_id,'role_key',v_run.role_key,'role_kind',v_role.role_kind,'role_config',v_role.config,'milestone_key',v_run.milestone_key,'mutation_domains',v_role.mutation_domains,'executor_profile',v_role.executor_profile,'lease_generation',v_run.lease_generation,'lease_expires_at',v_run.lease_expires_at,'input',v_run.input,'expected_github_sha',v_run.expected_github_sha,'base_checkpoint_id',v_run.base_checkpoint_id,'base_head_drift',v_run.base_checkpoint_id is distinct from v_status#>>'{semantic_head,checkpoint_id}','roadmap_status',v_status,'supervisor_snapshot',v_snapshot,'claim',v_claim,'directive',v_directive,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_defer_run_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_condition text,p_reason jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_reason jsonb:=coalesce(p_reason,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if; if jsonb_typeof(v_reason)<>'object' then raise exception 'reason_must_be_object' using errcode='22023'; end if;
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update;
  if not found or v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state='WAITING_EVENT',wake_condition=p_condition,lease_owner=null,lease_expires_at=null,error_class='DEFERRED',error_code=p_condition,error_text=left(v_reason::text,4000),updated_at=clock_timestamp() where run_id=p_run_id;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_DEFERRED',v_run.milestone_key,p_run_id,v_run.role_key,'AOP',jsonb_build_object('condition',p_condition,'reason',v_reason,'lease_generation',p_lease_generation),v_run.idempotency_key||':deferred:'||p_lease_generation::text||':'||p_condition,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-defer.h205f22.v1','run_id',p_run_id,'state','WAITING_EVENT','condition',p_condition,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_v1(p_condition text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare v_count integer;
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state='READY',wake_condition=null,updated_at=clock_timestamp() where state='WAITING_EVENT' and wake_condition=p_condition; get diagnostics v_count=row_count;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL',null,null,null,'EXTERNAL',jsonb_build_object('condition',p_condition,'payload',coalesce(p_payload,'{}'::jsonb),'woken_runs',v_count),'signal:'||p_condition||':'||clock_timestamp()::text,null);
  return jsonb_build_object('schema','metaengine.compute.aop-signal.h205f22.v1','condition',p_condition,'woken_runs',v_count,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_snapshot_v1() returns jsonb language sql security definer set search_path='pg_catalog','destruktion_meta' as $$
select jsonb_build_object('schema','metaengine.compute.aop-snapshot.h205f22.v1','invariant','NO_MANUAL_HANDOFF_V1','semantic_head',destruktion_meta.compute_fabric_roadmap_status_h205f22()->'semantic_head','roles',(select coalesce(jsonb_agg(to_jsonb(r) order by role_key),'[]'::jsonb) from destruktion_meta.compute_fabric_aop_role_h205f22 r where enabled),'active_runs',(select coalesce(jsonb_agg((to_jsonb(x)-'output') order by created_at,run_id),'[]'::jsonb) from destruktion_meta.compute_fabric_aop_run_h205f22 x where state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT')),'recent_events',(select coalesce(jsonb_agg(to_jsonb(e) order by event_id desc),'[]'::jsonb) from (select * from destruktion_meta.compute_fabric_aop_event_h205f22 order by event_id desc limit 50) e),'canonical',false,'authority_effect',false) $$;

-- The completion and authority bridge functions intentionally reuse the existing
-- authoritative roadmap functions. AOP never manufactures VERIFIED or seal state.
create or replace function public.h205f22_aop1_complete_run_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_result_code text,p_output jsonb default '{}'::jsonb,p_github_sha text default null,p_wake_condition text default null)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta','extensions' as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_output jsonb:=coalesce(p_output,'{}'::jsonb); v_sha text; v_event jsonb; v_event_id bigint; v_next jsonb; v_terminal_state text:='COMPLETED'; v_impl_role text; v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype; v_finish jsonb; v_authoritative_status text;
begin
  if jsonb_typeof(v_output)<>'object' then raise exception 'output_must_be_object' using errcode='22023'; end if;
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update; if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key;
  if v_role.role_kind='IMPLEMENTER' and p_result_code not in ('CONTINUE','EVIDENCE_READY','WAITING_EVENT','FAILED') then raise exception 'invalid_implementer_result' using errcode='22023'; end if;
  if v_role.role_kind='ANALYST' and p_result_code not in ('ACCEPT','ACCEPT_WITH_REBASE','REQUEST_CHANGES','HOLD','REJECT') then raise exception 'invalid_analyst_result' using errcode='22023'; end if;
  if v_role.role_kind='SUPERVISOR' and p_result_code not in ('ACCEPT','RETURN','WAIT','VERIFIED','REJECT') then raise exception 'invalid_supervisor_result' using errcode='22023'; end if;
  if v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then
    if v_run.claim_id is null or jsonb_typeof(v_output->'summary') is distinct from 'object' or jsonb_typeof(v_output->'evidence') is distinct from 'object' or jsonb_typeof(v_output->'research') is distinct from 'object' then raise exception 'evidence_ready_requires_active_claim_and_summary_evidence_research' using errcode='22023'; end if;
    select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where claim_id=v_run.claim_id for update; if not found or v_claim.state<>'ACTIVE' or v_claim.expires_at<=now() then raise exception 'active_claim_required_for_evidence_ready' using errcode='55000'; end if;
    v_finish:=destruktion_meta.compute_fabric_finish_roadmap_claim_h205f22(v_claim.claim_id,v_claim.claim_token,v_output->'summary',v_output->'evidence',v_output->'research');
  end if;
  v_sha:=encode(extensions.digest(convert_to(v_output::text,'UTF8'),'sha256'),'hex'); if p_result_code='WAITING_EVENT' or (v_role.role_kind='SUPERVISOR' and p_result_code='WAIT') then v_terminal_state:='WAITING_EVENT'; end if; if (v_role.role_kind='IMPLEMENTER' and p_result_code='FAILED') or (v_role.role_kind='SUPERVISOR' and p_result_code='REJECT') then v_terminal_state:='FAILED'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state=v_terminal_state,output=v_output,output_sha256=v_sha,result_code=p_result_code,expected_github_sha=coalesce(p_github_sha,expected_github_sha),wake_condition=case when v_terminal_state='WAITING_EVENT' then coalesce(p_wake_condition,wake_condition,'EXTERNAL_CHANGE') else wake_condition end,lease_owner=null,lease_expires_at=null,finished_at=case when v_terminal_state in ('COMPLETED','FAILED') then clock_timestamp() else null end,updated_at=clock_timestamp() where run_id=p_run_id;
  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_RESULT_'||p_result_code,v_run.milestone_key,p_run_id,v_run.role_key,v_role.role_kind,v_output||case when v_finish is null then '{}'::jsonb else jsonb_build_object('authoritative_finish',v_finish) end,v_run.idempotency_key||':result:'||p_lease_generation::text||':'||p_result_code,p_github_sha); v_event_id:=(v_event->>'event_id')::bigint;
  if v_terminal_state='COMPLETED' then
    if v_role.role_kind='IMPLEMENTER' and p_result_code='CONTINUE' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_run.role_key,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','CONTINUE','previous_output_sha256',v_sha),'chain:continue:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','IMPLEMENTER_EVIDENCE_READY','evidence',v_output,'authoritative_finish',v_finish,'github_sha',p_github_sha),'chain:analyst:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='ANALYST' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','ANALYST_'||p_result_code,'analyst_verdict',v_output,'verdict_code',p_result_code,'github_sha',p_github_sha),'chain:supervisor:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='RETURN' then select role_key into v_impl_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_run.milestone_key and enabled=true; select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key; if v_authoritative_status<>'IN_PROGRESS' then raise exception 'supervisor_return_requires_authority_bridge_first' using errcode='55000'; end if; v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_impl_role,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_RETURN','required_changes',v_output,'github_sha',p_github_sha),'chain:supervisor-return:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='ACCEPT' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL','previous_output_sha256',v_sha,'github_sha',p_github_sha),'chain:supervisor-seal:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='VERIFIED' then select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key; if v_authoritative_status<>'VERIFIED' then raise exception 'cannot_record_verified_before_authoritative_roadmap_is_verified' using errcode='55000'; end if; perform destruktion_meta.compute_fabric_aop_reconcile_h205f22(); end if;
  end if;
  return jsonb_build_object('schema','metaengine.compute.aop-complete.h205f22.v2','run_id',p_run_id,'state',v_terminal_state,'result_code',p_result_code,'output_sha256',v_sha,'authoritative_finish',v_finish,'next_run',v_next,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_supervisor_adopt_active_claim_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_supervisor_token uuid,p_instructions jsonb default '{}'::jsonb,p_ttl_minutes integer default 180)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_impl destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype; v_holder text; v_cancel jsonb; v_directive jsonb; v_new_claim jsonb;
begin
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update; if not found or v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key; if v_role.role_kind<>'SUPERVISOR' then raise exception 'supervisor_role_required' using errcode='42501'; end if;
  if not exists(select 1 from destruktion_meta.compute_fabric_supervisor_control_h205f22 where supervisor_key='COMPUTE_FABRIC_MAINLINE' and roadmap_id=v_run.roadmap_id and supervisor_token=p_supervisor_token and mode='ACTIVE') then raise exception 'active_supervisor_capability_required' using errcode='42501'; end if;
  select * into v_impl from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_run.milestone_key and enabled=true; v_holder:='aop1:'||v_impl.role_key;
  select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id=v_run.roadmap_id and milestone_key=v_run.milestone_key and state='ACTIVE' and expires_at>clock_timestamp() order by claim_id desc limit 1 for update; if not found then raise exception 'active_claim_required_for_adoption' using errcode='55000'; end if;
  if v_claim.holder_id=v_holder then return jsonb_build_object('schema','metaengine.compute.aop-supervisor-adopt.h205f22.v1','milestone_key',v_run.milestone_key,'already_adopted',true,'claim_id',v_claim.claim_id,'holder_id',v_holder,'authority_effect',false,'canonical',false); end if;
  v_cancel:=destruktion_meta.compute_fabric_supervisor_cancel_claim_h205f22(p_supervisor_token,v_claim.claim_id,'AOP1 authority adoption: '||coalesce(p_instructions::text,'{}'),false);
  v_directive:=destruktion_meta.compute_fabric_supervisor_set_directive_h205f22(p_supervisor_token,v_run.milestone_key,'REASSIGN',v_holder,coalesce(p_instructions,'{}'::jsonb)||jsonb_build_object('automation_invariant','NO_MANUAL_HANDOFF_V1','previous_holder',v_claim.holder_id),p_ttl_minutes);
  v_new_claim:=destruktion_meta.compute_fabric_claim_roadmap_work_h205f22(v_run.milestone_key,v_holder,p_ttl_minutes);
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('SUPERVISOR_AUTHORITY_ADOPTED',v_run.milestone_key,v_run.run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('previous_claim_id',v_claim.claim_id,'new_claim_id',(v_new_claim->>'claim_id')::bigint,'previous_holder',v_claim.holder_id,'new_holder',v_holder,'directive_id',(v_directive->>'directive_id')::bigint),v_run.idempotency_key||':authority-adopt:'||p_lease_generation::text,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-supervisor-adopt.h205f22.v1','milestone_key',v_run.milestone_key,'already_adopted',false,'cancelled',v_cancel,'directive',v_directive,'new_claim',v_new_claim-'claim_token','implementer_role_key',v_impl.role_key,'authority_effect',true,'canonical',false);
end $$;

create or replace function public.h205f22_aop1_supervisor_return_authority_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_supervisor_token uuid,p_instructions jsonb,p_ttl_minutes integer default 180)
returns jsonb language plpgsql security definer set search_path='pg_catalog','destruktion_meta' as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype; v_impl destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_holder text; v_directive jsonb; v_new_claim jsonb;
begin
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update; if not found or v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key; if v_role.role_kind<>'SUPERVISOR' then raise exception 'supervisor_role_required' using errcode='42501'; end if;
  if not exists(select 1 from destruktion_meta.compute_fabric_supervisor_control_h205f22 where supervisor_key='COMPUTE_FABRIC_MAINLINE' and roadmap_id=v_run.roadmap_id and supervisor_token=p_supervisor_token and mode='ACTIVE') then raise exception 'active_supervisor_capability_required' using errcode='42501'; end if;
  select * into v_impl from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_run.milestone_key and enabled=true; v_holder:='aop1:'||v_impl.role_key;
  select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id=v_run.roadmap_id and milestone_key=v_run.milestone_key and state='EVIDENCE_READY' order by claim_id desc limit 1 for update; if not found then raise exception 'evidence_ready_claim_required_for_return' using errcode='55000'; end if;
  update destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 set state='RELEASED',heartbeat_at=now(),work_summary=work_summary||jsonb_build_object('supervisor_returned_at',now(),'supervisor_return_reason',coalesce(p_instructions,'{}'::jsonb)) where claim_id=v_claim.claim_id;
  update destruktion_meta.compute_fabric_roadmap_milestone_h205f22 set status='PLANNED',updated_at=now() where roadmap_id=v_run.roadmap_id and milestone_key=v_run.milestone_key and status='EVIDENCE_READY';
  v_directive:=destruktion_meta.compute_fabric_supervisor_set_directive_h205f22(p_supervisor_token,v_run.milestone_key,'REASSIGN',v_holder,coalesce(p_instructions,'{}'::jsonb),p_ttl_minutes); v_new_claim:=destruktion_meta.compute_fabric_claim_roadmap_work_h205f22(v_run.milestone_key,v_holder,p_ttl_minutes);
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('SUPERVISOR_RETURN_AUTHORITY_APPLIED',v_run.milestone_key,v_run.run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('released_claim_id',v_claim.claim_id,'new_claim_id',(v_new_claim->>'claim_id')::bigint,'directive_id',(v_directive->>'directive_id')::bigint,'holder_id',v_holder),v_run.idempotency_key||':authority-return:'||p_lease_generation::text,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-supervisor-return.h205f22.v1','milestone_key',v_run.milestone_key,'released_claim_id',v_claim.claim_id,'directive',v_directive,'new_claim',v_new_claim-'claim_token','implementer_role_key',v_impl.role_key,'authority_effect',true,'canonical',false);
end $$;

insert into destruktion_meta.compute_fabric_aop_role_h205f22(role_key,role_kind,milestone_key,mutation_domains,executor_profile,max_attempts,config) values
 ('W1_IMPLEMENTER','IMPLEMENTER','W1_PERSISTENT_LINUX_WORKER_SAFETY',array['worker','enrollment','execution_safety','scheduler'],'IMPLEMENTATION',8,jsonb_build_object('branch','work/w1-linux-worker-safety','issue',1)),
 ('T0_IMPLEMENTER','IMPLEMENTER','T0_HERMETIC_TOOLCHAIN_CONTRACT',array['toolchain','artifact_identity'],'IMPLEMENTATION',8,jsonb_build_object('branch','work/t0-hermetic-toolchain','issue',2)),
 ('F1_IMPLEMENTER','IMPLEMENTER','F1_LIVE_EXTERNAL_FEDERATION',array['federation','provider','signature'],'IMPLEMENTATION',8,jsonb_build_object('branch','work/f1-live-federation','issue',3)),
 ('R1_IMPLEMENTER','IMPLEMENTER','R1_CONTINUITY_PLANE_ADOPTION',array['continuity','checkpoint','durability'],'IMPLEMENTATION',8,jsonb_build_object('branch','work/r1-continuity-plane','issue',4)),
 ('A1_IMPLEMENTER','IMPLEMENTER','A1_ISOLATED_WORKSPACE_AGENT_ADAPTER',array['workspace','agent_adapter','isolation'],'IMPLEMENTATION',8,jsonb_build_object('branch','work/a1-agent-workspace','issue',5)),
 ('INTEGRATION_ANALYST','ANALYST',null,array[]::text[],'ANALYST',6,jsonb_build_object('branch','analysis/integration','issue',6)),
 ('MAINLINE_SUPERVISOR','SUPERVISOR',null,array['roadmap','directive','checkpoint','mainline'],'SUPERVISOR',6,jsonb_build_object('authority','EXISTING_SUPERVISOR_ONLY'))
on conflict(role_key) do update set role_kind=excluded.role_kind,milestone_key=excluded.milestone_key,mutation_domains=excluded.mutation_domains,executor_profile=excluded.executor_profile,max_attempts=excluded.max_attempts,config=excluded.config,enabled=true,updated_at=clock_timestamp();

revoke all on function destruktion_meta.compute_fabric_aop_emit_event_h205f22(text,text,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(text,text,bigint,uuid,jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function destruktion_meta.compute_fabric_aop_reconcile_h205f22() from public,anon,authenticated;
revoke all on function public.h205f22_aop1_lease_run_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_defer_run_v1(uuid,text,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_signal_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_snapshot_v1() from public,anon,authenticated;
revoke all on function public.h205f22_aop1_supervisor_adopt_active_claim_v1(uuid,text,bigint,uuid,jsonb,integer) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_supervisor_return_authority_v1(uuid,text,bigint,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_lease_run_v1(text,text,integer) to service_role;
grant execute on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) to service_role;
grant execute on function public.h205f22_aop1_defer_run_v1(uuid,text,bigint,text,jsonb) to service_role;
grant execute on function public.h205f22_aop1_signal_v1(text,jsonb) to service_role;
grant execute on function public.h205f22_aop1_snapshot_v1() to service_role;
grant execute on function public.h205f22_aop1_supervisor_adopt_active_claim_v1(uuid,text,bigint,uuid,jsonb,integer) to service_role;
grant execute on function public.h205f22_aop1_supervisor_return_authority_v1(uuid,text,bigint,uuid,jsonb,integer) to service_role;

select destruktion_meta.compute_fabric_aop_emit_event_h205f22('AOP1_BOOTSTRAPPED',null,null,'MAINLINE_SUPERVISOR','SUPERVISOR',jsonb_build_object('invariant','NO_MANUAL_HANDOFF_V1','semantic_authority','SUPABASE_ROADMAP'),'aop1:bootstrap:v1',null);
select destruktion_meta.compute_fabric_aop_reconcile_h205f22();
